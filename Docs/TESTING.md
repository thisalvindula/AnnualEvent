# Testing guide (Phase 1–6, complete)

This covers manual/scripted testing of the whole app: the Docker stack,
health check, employee import, NIC verification rules, admin auth/audit, and
the full raffle and voting modules. For the automated unit/integration test
suite, see section 9 below. For k6 load testing, event-day operations, and
VPS deployment, see [Docs/RUNBOOK.md](RUNBOOK.md) and
[Docs/DEPLOYMENT.md](DEPLOYMENT.md) instead — this file stays focused on
verifying the app works, not running the actual event.

Run everything from the project root: `/Users/thisalvindula/Projects/AnnualEvent`.

## 0. Start the stack

```bash
docker compose up -d --build
docker compose ps        # all three (db, app, caddy) should be "Up" / "healthy"
docker compose logs app --tail 20
```

You should see `Applied N migration(s).` on first boot, and `No pending
migrations.` on later restarts.

Two ways to reach the app:
- **Direct, HTTP**: `http://localhost:3000` — what a phone on the same Wi-Fi
  would use (`http://<your-mac-ip>:3000`). Good for the landing page and
  `/api/health`, but **admin login will not work here** — see note below.
- **Through Caddy, HTTPS**: `https://localhost` — uses a self-signed
  certificate for local dev, so curl needs `-k` and a browser will show a
  "not secure" warning you have to click through. **Use this for anything
  involving admin login.**

> **Why HTTPS matters for admin login**: the session cookie is set with the
> `Secure` flag (per requirement 10), which browsers refuse to store unless
> the page was loaded over HTTPS. So admin login/dashboard testing must go
> through `https://localhost`, not `http://localhost:3000` directly.

## 1. Health check

```bash
curl -s http://localhost:3000/api/health
curl -sk https://localhost/api/health
```

Expect `{"status":"ok","db":"ok"}` from both.

## 2. Create admin accounts

There's deliberately no HTTP route to create admin users (keeps that action
off the network entirely). Use the seed script, which runs with the
schema-owner DB credentials, not the app's restricted runtime role:

```bash
docker compose exec app node db/seed/create-admin.js raffle_admin 'ChangeMe123456!' raffle_operator
docker compose exec app node db/seed/create-admin.js vote_admin   'ChangeMe123456!' vote_operator
docker compose exec app node db/seed/create-admin.js audit_admin  'ChangeMe123456!' auditor
```

Re-running with the same username resets that user's password/role.

## 3. Admin login — browser walkthrough

1. Open `https://localhost/admin/login`, accept the certificate warning.
2. Log in as `raffle_admin` / the password you set above.
3. You should land on `/admin` showing both modules' status as `draft`.
4. Under "Employee master list", upload `db/seed/employees.sample.csv` (10
   fake employees with valid old/new-format NICs). It should report
   `{"imported":10,"errors":[]}`.
5. Try uploading `db/seed/employees.sample.invalid.csv` — it should report
   `imported: 0` and list a specific reason for each bad row (missing name,
   malformed NIC, etc.) instead of silently dropping them.
6. Log out via the link, then confirm `https://localhost/admin` redirects to
   a 401 (open it again — you should be bounced back to login).
7. Log in as `audit_admin` and download the audit log via the link on the
   dashboard — it should include every login, logout, and import event
   you just triggered.
8. While logged in as `raffle_admin`, try to open
   `https://localhost/admin/api/audit/export` directly — expect `403
   forbidden` (only the `auditor` role can export it).

## 4. Admin login — curl walkthrough (for scripting/CI)

The login/logout/import endpoints require a CSRF token, which is embedded in
the page as `data-csrf-token` on `<body>`. A full round trip:

```bash
# 1. Get the login page + a csrf cookie
curl -sk -c cookies.txt https://localhost/admin/login -o login.html
CSRF=$(grep -o 'data-csrf-token="[^"]*"' login.html | sed -E 's/.*"(.*)"/\1/')

# 2. Log in (reuses the same cookie jar)
curl -sk -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"username":"raffle_admin","password":"ChangeMe123456!"}' \
  https://localhost/admin/login
# -> {"ok":true,"role":"raffle_operator"}

# 3. Load the dashboard (grab a fresh csrf token from it for further POSTs)
curl -sk -b cookies.txt https://localhost/admin -o dashboard.html
DASH_CSRF=$(grep -o 'data-csrf-token="[^"]*"' dashboard.html | sed -E 's/.*"(.*)"/\1/')

# 4. Import employees
curl -sk -b cookies.txt -H "Content-Type: text/csv" -H "x-csrf-token: $DASH_CSRF" \
  --data-binary @db/seed/employees.sample.csv \
  https://localhost/admin/api/employees/import
```

Sanity checks worth trying:
- Omit `-H "x-csrf-token: ..."` on the login POST → expect `403 Forbidden`
  (`FST_CSRF_MISSING_SECRET` or similar).
- Log in with a wrong password, and separately with a username that doesn't
  exist → both should return the identical `401 {"message":"Invalid
  username or password"}` (no hint about which one was wrong).
- `curl -sk https://localhost/admin` with no cookie jar → `401`.

## 5. NIC verification rules (direct function check)

The raffle module's `/raffle/api/verify` now exercises this for real (see
section 7 below). This direct check is still useful for confirming the
lockout timing without waiting on a live window:

```bash
docker compose exec app node --input-type=module -e "
import { verifyEmployeeCredentials } from './app/core/employees/index.js';
const ip = '10.0.0.1';
console.log(await verifyEmployeeCredentials({ empId: 'E001', last4: '3149', ip, module: 'raffle' })); // ok:true, name
console.log(await verifyEmployeeCredentials({ empId: 'E001', last4: '0000', ip, module: 'raffle' })); // ok:false, generic
console.log(await verifyEmployeeCredentials({ empId: 'E999', last4: '1234', ip, module: 'raffle' })); // same generic shape
"
```

(This process will hang after printing — it's waiting on the open DB pool.
Ctrl+C or `docker compose exec app pkill -f input-type=module` once you've
seen the output.)

What to check:
- Correct `emp_id` + correct last-4 → `{ ok: true, empId, name }`.
- Wrong last-4 and unknown `emp_id` → **identical** response shape
  (`{ ok: false, reason: 'invalid', message: 'Please contact HR' }`), so a
  guesser can't tell a valid ID from an invalid one.
- 3 wrong attempts in a row for the same `emp_id` → the 4th attempt (even
  with the *correct* NIC) returns `{ ok: false, reason: 'locked', ... }` for
  about 5 minutes.
- `employees.sample.csv` has both NIC formats to test:
  old (`960433149V` → last4 `3149`) and new (`199604303149` → last4 `3149`).

Every failed attempt should also show up in the audit log export (step 3.7)
as `verify_nic_mismatch`, `verify_unknown_employee`, or `verify_locked`.

## 6. Direct database checks (optional, sanity only)

```bash
docker compose exec db psql -U event_app_owner -d annual_event -c "\dt"

# Confirm NIC digits are never stored in plaintext:
docker compose exec db psql -U event_app_owner -d annual_event \
  -c "SELECT emp_id, nic_last4_hash FROM employees LIMIT 3;"

# Confirm the app's runtime DB role can append to audit_log but never alter it:
docker compose exec db psql -U event_app_owner -d annual_event -c "
  SELECT grantee, privilege_type FROM information_schema.role_table_grants
  WHERE table_name='audit_log' AND grantee='app_runtime' ORDER BY privilege_type;
"
# Expect exactly: INSERT, SELECT — no UPDATE, no DELETE.
```

## 7. Raffle module walkthrough

Prerequisites: admin logged in as `raffle_operator` (section 3/4) and
employees imported (section 3, step 4).

### 7.1 Configure the gift list

Open `https://localhost/admin/raffle` in a browser (or use curl). The gift
list must be **exactly 10 "normal" + 15 "premium"** entries — the server
rejects anything else:

```bash
curl -sk -c c.txt https://localhost/admin/login -o l.html
CSRF=$(grep -o 'data-csrf-token="[^"]*"' l.html | sed -E 's/.*"(.*)"/\1/')
curl -sk -b c.txt -c c.txt -H "Content-Type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"username":"raffle_admin","password":"<your password>"}' https://localhost/admin/login

curl -sk -b c.txt https://localhost/admin/raffle -o ra.html
RCSRF=$(grep -o 'data-csrf-token="[^"]*"' ra.html | sed -E 's/.*"(.*)"/\1/')

# gifts must be exactly 10 normal + 15 premium, or this returns a 400
curl -sk -b c.txt -H "Content-Type: application/json" -H "x-csrf-token: $RCSRF" \
  -d '{"gifts":[{"name":"Gift 1","tier":"normal"}, ... ]}' \
  https://localhost/admin/api/raffle/config
```

Try 9 normal + 15 premium → expect a `400` with a message naming the actual
counts. Try configuring gifts again after opening (next step) → expect
`400 "Cannot change the gift list once the raffle has opened"`.

### 7.2 Open, register, and verify duplicate/window rejection

```bash
curl -sk -b c.txt -H "Content-Type: application/json" -H "x-csrf-token: $RCSRF" \
  -d '{"windowMinutes": 15}' https://localhost/admin/api/raffle/open

curl -sk https://localhost/raffle/api/status   # isOpen:true, secondsRemaining counting down

# On a phone (or curl), verify then register:
curl -sk -H "Content-Type: application/json" -d '{"empId":"E001","last4":"3149"}' https://localhost/raffle/api/verify
curl -sk -H "Content-Type: application/json" -d '{"empId":"E001","last4":"3149"}' https://localhost/raffle/api/register
# -> {"ok":true,"ticketNo":1,"name":"Alice Perera"}

# Registering again must say "You are already registered":
curl -sk -H "Content-Type: application/json" -d '{"empId":"E001","last4":"3149"}' https://localhost/raffle/api/register
```

Close (or let the window expire), then confirm registration is rejected:

```bash
curl -sk -b c.txt -H "x-csrf-token: $RCSRF" -X POST https://localhost/admin/api/raffle/close
curl -sk -H "Content-Type: application/json" -d '{"empId":"E002","last4":"3149"}' https://localhost/raffle/api/register
# -> {"ok":false,"reason":"closed","message":"Raffle registration is not open right now"}
```

### 7.3 Concurrency check (one success per employee)

With the raffle open and `E003` not yet registered:

```bash
seq 1 50 | xargs -P 50 -I{} curl -sk -H "Content-Type: application/json" \
  -d '{"empId":"E003","last4":"2345"}' https://localhost/raffle/api/register > results.txt
grep -o '"ok":true' results.txt | wc -l        # must be exactly 1
grep -o 'already_registered' results.txt | wc -l  # must be 49
```

### 7.4 Big screen

Find the screen token and try it with and without it:

```bash
docker compose exec app printenv SCREEN_TOKEN_RAFFLE

curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/screen/raffle            # 403, no token
curl -sk -o /dev/null -w "%{http_code}\n" "https://localhost/screen/raffle?token=wrong"  # 403, wrong token
curl -sk -o /dev/null -w "%{http_code}\n" "https://localhost/screen/raffle?token=<real token>"  # 200
```

> If you're testing locally through Docker (not directly on the VPS), the
> app sees your request's IP as Docker's internal gateway address, not
> `127.0.0.1` — check `docker compose logs app` for the `remoteAddress` it
> logged and add that to `SCREEN_ALLOWED_IPS` in `.env` if the screen route
> 403s even with the right token. On the real VPS, add the venue/admin
> laptop's actual IP instead.

Open `https://localhost/screen/raffle?token=<real token>` in a browser — it
should show a countdown and live entry count, and update via SSE as people
register or as the admin seals the list / draws winners.

### 7.5 Seal the list, then draw

```bash
# Seals the list: exports registrations CSV, computes SHA-256, and pushes
# {count, sha256} to the big screen via SSE — do this before the first draw.
curl -sk -b c.txt -D headers.txt -o registrations.csv https://localhost/admin/api/raffle/registrations/export
grep -i 'x-entry-count\|x-sha-256' headers.txt

# Draw one winner at a time (normal gifts first, premium last):
curl -sk -b c.txt -H "x-csrf-token: $RCSRF" -X POST https://localhost/admin/api/raffle/draw/next
```

Repeat the draw call — the big screen should animate each new winner. Once
every registered (and not-yet-won) employee has won, further draws return
`{"ok":false,"message":"No eligible entrants remain"}` rather than erroring
or double-assigning — this is expected if there are fewer entrants than
gifts. Verify no one won twice:

```bash
docker compose exec db psql -U event_app_owner -d annual_event \
  -c "SELECT emp_id, count(*) FROM raffle_draw_results GROUP BY emp_id HAVING count(*) > 1;"
# must return 0 rows
```

Download the final results:

```bash
curl -sk -b c.txt https://localhost/admin/api/raffle/results/export
```

### 7.6 Role checks specific to raffle

- `vote_operator` and unauthenticated requests must get `401`/`403` on every
  `/admin/api/raffle/*` route.
- `raffle_operator` and `auditor` can both read
  `/admin/api/raffle/registrations/export` and `/results/export`; only
  `raffle_operator` can open/close/configure/draw.

## 8. Voting module walkthrough

Prerequisites: admin logged in as `vote_operator`, employees imported.

### 8.1 Configure finalists and duration, then start

Finalists must be **exactly 5**, with unique positions 1–5. Locked once
voting starts (unlike raffle's gift-list lock, this is the literal
requirement 9.4 rule, not just a design choice).

```bash
curl -sk -c c.txt https://localhost/admin/login -o l.html
CSRF=$(grep -o 'data-csrf-token="[^"]*"' l.html | sed -E 's/.*"(.*)"/\1/')
curl -sk -b c.txt -c c.txt -H "Content-Type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"username":"vote_admin","password":"<your password>"}' https://localhost/admin/login

curl -sk -b c.txt https://localhost/admin/vote -o va.html
VCSRF=$(grep -o 'data-csrf-token="[^"]*"' va.html | sed -E 's/.*"(.*)"/\1/')

curl -sk -b c.txt -H "Content-Type: application/json" -H "x-csrf-token: $VCSRF" \
  -d '{"finalists":[{"name":"Alice","song":"Song A","position":1},{"name":"Bob","position":2},{"name":"Chamari","position":3},{"name":"Dinesh","position":4},{"name":"Eshan","position":5}]}' \
  https://localhost/admin/api/vote/finalists

curl -sk -b c.txt -H "Content-Type: application/json" -H "x-csrf-token: $VCSRF" \
  -d '{"durationMinutes": 15}' https://localhost/admin/api/vote/config

curl -sk -b c.txt -H "x-csrf-token: $VCSRF" -X POST https://localhost/admin/api/vote/start
```

Try editing finalists again after start → expect `400 "Cannot change
finalists once voting has started"`.

### 8.2 Verify, cast, self-vote, duplicate, and window rejection

```bash
curl -sk https://localhost/vote/api/status
# -> {"serverTime":...,"status":"open","isOpen":true,"secondsRemaining":...}
# Note: no vote counts here, by design — employee phones never see them.

curl -sk -H "Content-Type: application/json" -d '{"empId":"E001","last4":"3149"}' https://localhost/vote/api/verify
# -> {"ok":true,"empId":"E001","name":"Alice Perera","finalists":[{"id":1,"name":"Alice",...}, ...]}

# Finalists may vote for themselves — no restriction (requirement 3):
curl -sk -H "Content-Type: application/json" -d '{"empId":"E001","last4":"3149","finalistId":1}' https://localhost/vote/api/cast
# -> {"ok":true,"message":"Vote recorded"}

# Second attempt must be rejected, both at cast and at verify:
curl -sk -H "Content-Type: application/json" -d '{"empId":"E001","last4":"3149","finalistId":2}' https://localhost/vote/api/cast
curl -sk -H "Content-Type: application/json" -d '{"empId":"E001","last4":"3149"}' https://localhost/vote/api/verify
# both -> {"ok":false,"reason":"already_voted","message":"You have already voted"}
```

Close (or let it expire), then confirm cast is rejected:

```bash
curl -sk -b c.txt -H "x-csrf-token: $VCSRF" -X POST https://localhost/admin/api/vote/close
curl -sk -H "Content-Type: application/json" -d '{"empId":"E002","last4":"3149","finalistId":1}' https://localhost/vote/api/cast
# -> {"ok":false,"reason":"closed","message":"Voting is not open right now"}
```

### 8.3 Concurrency check (one success per employee)

```bash
seq 1 50 | xargs -P 50 -I{} curl -sk -H "Content-Type: application/json" \
  -d '{"empId":"E003","last4":"2345","finalistId":1}' https://localhost/vote/api/cast > results.txt
grep -o '"ok":true' results.txt | wc -l       # must be exactly 1
grep -o 'already_voted' results.txt | wc -l   # must be 49
```

### 8.4 Big screen (live tally, throttled)

```bash
docker compose exec app printenv SCREEN_TOKEN_VOTE

curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/screen/vote               # 403, no token
curl -sk -o /dev/null -w "%{http_code}\n" "https://localhost/screen/vote?token=wrong" # 403, wrong token
```

Open `https://localhost/screen/vote?token=<real token>` in a browser — it
shows a countdown and a live bar chart per finalist, updating as votes come
in (throttled server-side to at most once per second). Employee phones never
show this. To check the raw SSE feed sends an immediate snapshot on connect
(not just future updates):

```bash
curl -sk --max-time 2 "https://localhost/screen/vote/stream?token=<real token>"
# should immediately print an `event: tally` line with current counts
```

### 8.5 Close and export (auditor role only)

Unlike raffle's exports, `vote_operator` is explicitly **not** allowed to
read the results — only `auditor` can (requirement 7.3/10, since this file
contains employee IDs linked to their vote):

```bash
curl -sk -o /dev/null -w "%{http_code}\n" -b c.txt https://localhost/admin/api/vote/results/export
# -> 403 (logged in as vote_operator)

# Log in as audit_admin instead, then:
curl -sk -b ac.txt -D headers.txt -o votes.csv https://localhost/admin/api/vote/results/export
grep -i 'x-total-votes\|x-sha-256' headers.txt
cat votes.csv   # emp_id, voter_name, finalist, position, voted_at, ip, user_agent
```

### 8.6 Both modules open at once

Open raffle registration (section 7.2) while voting is still open, then:

```bash
curl -sk https://localhost/raffle/api/status
curl -sk https://localhost/vote/api/status
curl -sk -b <raffle-admin-cookie-jar> https://localhost/admin   # both show "open"
```

Neither module's state should affect the other.

## 9. Automated test suite

Two suites, matching the requirements (section 12):

- **Unit** (`tests/unit/`) — pure functions, no database: NIC normalization,
  password hash/verify (argon2), time-window boundary logic (including the
  literal "1 second before / at / 1 second after close" cases), the
  draw-without-replacement algorithm, and a static scan proving
  `modules/raffle` and `modules/voting` never import each other — extended to
  also scan the React frontend (`frontend/raffle`, `frontend/voting`,
  `frontend/admin/raffle`, `frontend/admin/vote`) for the same cross-imports.
- **Integration** (`tests/integration/`) — the real service layer against
  the real dockerized Postgres, using the same restricted `app_runtime` DB
  role the app itself uses. Covers: enumeration resistance + lockout, the
  full raffle lifecycle (gift validation, register/duplicate, concurrency,
  real-time window expiry, close-before-draw, draw without replacement,
  exports), the full voting lifecycle (finalist validation/locking,
  verify/cast, self-voting, concurrency, live tally, close-before-export),
  and isolation (both literal state pairs: raffle open + voting closed, and
  the reverse).

### Running them

Unit tests can run anywhere Node is installed (they touch no database):

```bash
npm install        # once, if you haven't already
npm run test:unit
```

Integration tests need the real Postgres from the Docker stack, and
`DATABASE_URL`/`MIGRATION_DATABASE_URL` in `.env` point at the Docker-internal
hostname `db` — so run them **inside the app container**, bind-mounting the
test files (they aren't baked into the production image):

```bash
docker compose up -d db        # make sure the db service is running
docker compose run --rm -v "$(pwd)/tests:/usr/src/app/tests" app npm run test:unit
docker compose run --rm -v "$(pwd)/tests:/usr/src/app/tests" app npm run test:integration
```

**Warning**: the integration suite calls `resetDatabase()` in each test
file's `before()` hook, which `TRUNCATE`s `employees`, `raffle_*`, `vote_*`,
and `audit_log` and resets both configs to `draft`. Never point
`MIGRATION_DATABASE_URL` at a real event's database when running these —
use a throwaway/dev stack only. `docker compose run` here uses whatever `db`
volume is currently up, so reset it afterward if you want a clean slate for
manual testing:

```bash
docker compose down -v && docker compose up -d --build
```

### What the tests caught

Writing these surfaced two real gaps that are now fixed (not just test
adjustments): `drawNext()` and `exportRegistrations()` (raffle), and
`exportResults()` (voting), didn't previously require the module to actually
be **closed** first — an admin could technically draw winners or export
results while registration/voting was still silently accepting entries,
which would have undermined the "seal the list, then draw" integrity story
in requirement 9.3/9.4. All three now return `{"ok":false,"message":"Close
... before ..."}` until the module is explicitly closed.

### Frontend bundle-size check

Employee pages (`/raffle`, `/vote`) must stay well under the 50 KB gzipped-JS
budget from `Docs/REQUIREMENTS.md` section 5 (target 15–20 KB) — build the
frontend, then check it:

```bash
npm run build:frontend
npm run check:bundle-size
```

`scripts/check-bundle-size.js` reads the built `frontend/dist/raffle/register/index.html`
and `frontend/dist/voting/vote/index.html`, gzips every referenced
`/assets/*.js`/`*.css` file, sums them, and exits non-zero if either page
exceeds the 50 KB hard budget (it warns, but doesn't fail, above the 20 KB
ideal target).

### Manual walkthrough against the React frontend

The React + Vite frontend (see `Docs/REACT_FRONTEND_PROMPT.md`) replaces every
server-rendered HTML page; before signing off on a frontend change, re-walk
`Docs/Steps.txt` end-to-end against the built app (`npm run build:frontend &&
npm start`, or `docker compose up --build`) — register → close → seal → draw
on `/screen/raffle`; verify → vote → live bars on `/screen/vote`; admin
login/logout; audit CSV export — and confirm `/screen/raffle`/`/screen/vote`
still 403 without a valid `token` (the built HTML is served behind the same
`requireScreenAccess` preHandler as before).

## Resetting between test runs

```bash
docker compose down -v   # wipes the database volume too — starts fully fresh
docker compose up -d --build
```
