# Annual Event App: Raffle Draw + Singing Competition Voting

> Hand this file to Claude Code as the single source of truth. Build exactly what is described here. If anything is unclear or missing, do not guess: ask the owner.

---

## 1. Overview

An organization of about 800 employees holds an annual event. Two live features are needed, delivered as **one web application** with **two fully isolated modules**:

1. **Raffle draw**: employees register by scanning a QR code during a timed window, then the winners for every configured gift are drawn live on stage.
2. **Singing competition voting**: employees vote for 1 of 5 finalists by scanning a different QR code during a timed window, with live vote counts on the big screen.

Both involve company money or reputation, so **transparency, auditability and tamper resistance** are core requirements.

## 2. Goals and non-goals

**Goals**
- One deployable app: one Docker Compose stack, one domain, one PostgreSQL database.
- Two modules that never depend on each other.
- Free to run (no paid software; only a small VPS).
- Handle 800 simultaneous users per module on a small VPS.
- Every registration, vote, draw and failed attempt is logged and exportable.

**Non-goals**
- No user accounts for employees (identity is checked by employee number + last 4 NIC digits).
- No native mobile app (mobile web only).
- No load balancer or multi-server cluster. A single small server is enough. Optional: two app instances behind Caddy sharing one database.

## 3. Confirmed decisions (do not re-ask)

| Topic | Decision |
|---|---|
| Employees | About 800, each with a unique employee ID; master list is pre-loaded |
| Identity check | Employee number + **last 4 NIC digits**, for both modules (rule in 9.2) |
| Gift collection | Not tracked by the app. No "collected" status, column or button |
| Raffle window | 15 minutes by default, configurable by admin |
| Raffle gifts | An admin-editable list, each row: gift id, place (e.g. "1st place"), quantity (number of winners), description (e.g. "Cash 100000"). Any number of gifts; ids, places, quantities and descriptions can be changed at any time (winners already drawn are protected, see 9.3). Draw order is ascending gift id |
| Employee records | Employee ID, name, NIC and photo image name. No department. The last 4 NIC digits are kept hashed (used for verification); the full NIC is also kept encrypted so admins can see it on the Lists page and correct a wrong one. Admins can add, edit and delete employees (and bulk-import a CSV) |
| Raffle draw | Live on stage, secure random, without replacement, one win per person |
| Absent winners | **Not an issue.** An absent winner is still a winner and collects the gift later. No redraw logic |
| Voting eligibility | Employees only, one vote each |
| Vote changes | **No.** The first vote is final |
| Finalists voting | **Finalists may vote for themselves** (no restriction) |
| Vote visibility | Live counts on the **big screen only**. Voters' phones never see counts |
| Vote traceability | Vote stores the employee ID with the choice, for full audit |
| Voting duration | 15 minutes by default, admin can set any duration |
| QR codes | **Separate QR per module**: raffle points to `/raffle`, voting points to `/vote` |
| Big screens | Two separate pages, one per module. Employees cannot see them |
| Language | English (UI text) |
| Users' network | Employees use their own phones on mobile data, not venue Wi-Fi |

## 4. Open items (ask the owner before implementing)

- None at the moment. If anything is unclear while building, stop and ask the owner instead of guessing.

## 5. Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js LTS (22+), ES modules |
| Web framework | Fastify |
| Database | PostgreSQL 16 |
| DB access | `pg` (node-postgres) with parameterized queries, plain SQL migrations |
| Frontend | Vite-built multi-page React app (`frontend/`), one entry per page. `react`/`react-dom` are aliased to `preact/compat` so every bundle ships Preact's ~4 KB runtime. Employee pages (`/raffle`, `/vote`) have no animation/transitions and stay well under 50 KB gzipped JS (target 15–20 KB); the big-screen pages (`/screen/raffle`, `/screen/vote`) carry the app's animation/confetti and have no bundle budget. Admin pages (`/admin`, `/admin/raffle`, `/admin/vote`) are also React, fetching session/CSRF/status from small `/admin/api/*` JSON endpoints |
| Live updates | Server-Sent Events (SSE), used only by the big-screen pages |
| Reverse proxy / HTTPS | Caddy (automatic certificates) |
| Packaging | Docker Compose (services: `app`, `db`, `caddy`) |
| Load testing | k6, run from a separate machine |
| Password hashing (admin) | argon2 |
| Security plugins | `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie` |

Suggested packages are guidance, not a hard requirement. Keep dependencies minimal.

## 6. Architecture

One app with a shared `core` and two isolated feature modules.

```
/
  docker-compose.yml
  Caddyfile
  .env.example
  db/
    migrations/            # ordered .sql files (core, raffle, voting kept separate)
    seed/                  # sample employees for local testing (fake data only)
  app/
    server.js              # boots Fastify, registers core + modules
    core/
      config.js
      db.js
      auth/                # admin login, sessions, roles
      employees/           # import, lookup, NIC verification
      audit/               # append-only audit logger
      timewindow.js        # server-side open/close checks (uses DB time)
      sse-hub.js           # channels for live screens
      nic.js               # NIC normalization (see 9.2)
      ratelimit.js
    modules/
      raffle/
        routes.js  service.js  repo.js  admin.js  pages/
      voting/
        routes.js  service.js  repo.js  admin.js  pages/
  tests/
    unit/  integration/  k6/
  docs/
    RUNBOOK.md
```

### Isolation rules (strict)

- `modules/raffle` and `modules/voting` **must never import from each other**. Enforce with a lint rule or a test that scans imports.
- Modules may import from `core` only.
- Each module has its own: URL prefix, tables (`raffle_*`, `vote_*`), status and timing config, SSE channel, QR target, big-screen page, admin section and CSV exports.
- Opening or closing one module never affects the other. Both may be open at the same time.
- Admin roles: `raffle_operator` (raffle admin only), `vote_operator` (voting admin only), `auditor` (read-only plus exports, including the votes CSV with employee IDs).

## 7. Routes

Route naming rule: employee-facing = `/<module>`, employee API = `/<module>/api/...`, big screen = `/screen/<module>`, admin UI = `/admin/<module>`, admin API = `/admin/api/<module>/...`.

### 7.1 Shared core

| Method + Route | Meaning |
|---|---|
| `GET /` | Neutral landing page ("Nothing is open right now"). No links to either module |
| `GET /api/health` | Uptime check |
| `GET /admin` | Admin dashboard showing the status of both modules |
| `GET /admin/login`, `POST /admin/login`, `POST /admin/logout` | Operator authentication |
| `POST /admin/api/employees/import` | Upload the employee master list as CSV `emp_id,name,nic,image_name` (full NIC: the last 4 digits are hashed for verification and the full NIC is stored encrypted; `image_name` is optional) |
| `POST /admin/api/employees`, `PUT /admin/api/employees/:empId`, `DELETE /admin/api/employees/:empId` | Add, edit (name, NIC, image name) or delete a single employee. `GET /admin/api/employees` returns each employee's decrypted `nic` (null if none stored). Correcting a NIC also clears that employee's wrong-attempt lockout. Delete is refused if the employee already has a raffle entry, vote or finalist link |
| `GET /admin/api/audit/export` | Full audit log CSV (auditor role) |

### 7.2 Raffle module (raffle QR points to `/raffle`)

| Method + Route | Meaning |
|---|---|
| `GET /raffle` | Registration page for employees |
| `GET /raffle/api/status` | Server time, window state, seconds remaining |
| `POST /raffle/api/verify` | Body: employee number + last 4 NIC digits. On success returns the employee name for confirmation |
| `POST /raffle/api/register` | Confirms registration, returns ticket number. If already registered returns "You are already registered" |
| `GET /screen/raffle?token=...` | Big screen: countdown, entry count, draw animation |
| `GET /screen/raffle/stream` | SSE channel for that screen only |
| `GET /admin/raffle` | Raffle admin UI |
| `POST /admin/api/raffle/gifts`, `PUT /admin/api/raffle/gifts/:id`, `DELETE /admin/api/raffle/gifts/:id` | Add, edit or delete a gift (`id`, `place`, `quantity`, `description`). `GET /admin/api/raffle/gifts` lists them |
| `POST /admin/api/raffle/open`, `POST /admin/api/raffle/close` | Manual open and close |
| `GET /admin/api/raffle/registrations/export` | Registrations CSV + entry count + SHA-256 of the file |
| `POST /admin/api/raffle/draw/next` | Draws the next winner (see 9.3) |
| `GET /admin/api/raffle/results/export` | Draw results CSV |

### 7.3 Voting module (voting QR points to `/vote`)

| Method + Route | Meaning |
|---|---|
| `GET /vote` | Voting page for employees |
| `GET /vote/api/status` | Server time, open or closed, seconds remaining |
| `POST /vote/api/verify` | Body: employee number + last 4 NIC digits. If valid and not yet voted, returns the employee name and the 5 finalists. If already voted returns "You have already voted" |
| `POST /vote/api/cast` | Body: chosen finalist. Records the vote. A second attempt returns "already voted" |
| `GET /screen/vote?token=...` | Big screen: countdown and live counts for the 5 finalists |
| `GET /screen/vote/stream` | SSE channel for that screen only |
| `GET /admin/vote` | Voting admin UI |
| `POST /admin/api/vote/finalists` | Set the 5 finalists (name, song, display order). **Locked once voting has started** |
| `PUT /admin/api/vote/finalists/:id` | Edit one finalist's name, song or linked employee ID in place (used by the admin Lists page). Same lock: refused once voting has started |
| `POST /admin/api/vote/config` | Set voting duration (default 15 min, any value) |
| `POST /admin/api/vote/start`, `POST /admin/api/vote/close` | Start voting; close early |
| `GET /admin/api/vote/results/export` | Votes CSV (with employee IDs) + final tally + SHA-256 of the tally (auditor role) |

## 8. Database

Duplicate prevention **must be enforced by the database** (primary key or unique constraint), not only by application code.

```sql
-- CORE
CREATE TABLE employees (
  emp_id         text PRIMARY KEY,
  name           text NOT NULL,
  image_name     text,                  -- photo file name in employee-photos/, e.g. E001.jpg
  nic_last4_hash text NOT NULL,         -- salted/peppered hash, never plain text; the only value verification uses
  nic_encrypted  text                   -- full NIC, AES-256-GCM (key derived from NIC_PEPPER); admin display only, NULL if not stored
);

CREATE TABLE admin_users (
  id            serial PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,          -- argon2
  role          text NOT NULL CHECK (role IN ('raffle_operator','vote_operator','auditor'))
);

CREATE TABLE audit_log (
  id     bigserial PRIMARY KEY,
  ts     timestamptz NOT NULL DEFAULT now(),
  module text,                           -- 'raffle' | 'voting' | 'core'
  event  text NOT NULL,
  emp_id text,
  ip     inet,
  detail jsonb
);
-- The app's DB user gets INSERT and SELECT on audit_log only (no UPDATE or DELETE).

-- RAFFLE
CREATE TABLE raffle_config (
  id        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  opens_at  timestamptz,
  closes_at timestamptz,
  status    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed'))
);

CREATE TABLE raffle_gifts (
  id          int PRIMARY KEY,           -- admin-chosen; draw order is ascending id
  place       text NOT NULL,             -- e.g. '1st place', 'Consolation Prize'
  quantity    int NOT NULL DEFAULT 1 CHECK (quantity >= 1),   -- number of winners
  description text NOT NULL              -- e.g. 'Cash 100000'
);

CREATE TABLE raffle_registrations (
  emp_id        text PRIMARY KEY REFERENCES employees(emp_id),   -- one entry per person
  ticket_no     serial UNIQUE,
  registered_at timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text
);

CREATE TABLE raffle_draw_results (
  gift_id      int NOT NULL REFERENCES raffle_gifts(id) ON UPDATE CASCADE,
  slot         int NOT NULL CHECK (slot >= 1),        -- 1..quantity within the gift
  emp_id       text UNIQUE NOT NULL REFERENCES raffle_registrations(emp_id),  -- wins once
  drawn_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gift_id, slot)
);

-- VOTING
CREATE TABLE vote_config (
  id        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  opens_at  timestamptz,
  closes_at timestamptz,
  duration_minutes int NOT NULL DEFAULT 15,
  status    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed'))
);

CREATE TABLE vote_finalists (
  id       serial PRIMARY KEY,
  name     text NOT NULL,
  song     text,
  position int NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 5)
);

CREATE TABLE vote_votes (
  emp_id      text PRIMARY KEY REFERENCES employees(emp_id),      -- one vote per person, first is final
  finalist_id int NOT NULL REFERENCES vote_finalists(id),
  voted_at    timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  user_agent  text
);
```

Atomic writes (example pattern, apply to both registration and voting):

```sql
INSERT INTO vote_votes (emp_id, finalist_id, ip, user_agent)
VALUES ($1, $2, $3, $4)
ON CONFLICT (emp_id) DO NOTHING
RETURNING emp_id;
-- no row returned -> already voted
```

## 9. Behaviour rules

### 9.1 Timing
- All open/close checks use **server time (PostgreSQL `now()`)**, never the client clock.
- A request outside the window is rejected by the server even if the page is still displayed.
- Hiding a QR code is not a control. The server is the only authority.
- Status and window logic lives in `core/timewindow.js` and is used by both modules with their own config rows.

### 9.2 Employee verification (both modules)
- **NIC rule (confirmed):** the check value is the **last 4 digits of the NIC, excluding any letter**.
  - Old format: 9 digits + 1 letter (`V` or `X`), e.g. `960433149V` gives `3149`. Ignore the letter and take the last 4 of the 9 digits.
  - New format: 12 digits, e.g. `199604303149` gives `3149`. Take the last 4 digits.
  - Implement this in one function, `core/nic.js`, used **both** when importing the employee list and when verifying, so the two can never differ.
  - Normalization: trim spaces and uppercase the letter. Accept only `^\d{9}[VX]$` or `^\d{12}$`. Reject anything else at import and list the bad rows in the import result instead of silently skipping them.
  - The voter normally types just the 4 digits. If they type a full NIC by mistake (old or new format), the server extracts the last 4 the same way and it works. Anything else is rejected with the generic failure.
- One step: `verify` takes employee number and last 4 NIC digits together. **Show the employee name only after both match.** Never return a name for an employee number alone (prevents enumeration of colleagues' names).
- Compare against the stored salted/peppered hash using a constant-time comparison.
- Rate-limit per IP and per employee ID. After 3 wrong NIC attempts, lock that employee ID for a few minutes. Log every failed attempt in `audit_log`.
- Unknown employee number gets a generic failure ("Please contact HR"), same shape as a wrong NIC to avoid leaking which IDs exist.
- Free-text names are **not** allowed. The name always comes from the employee list.

### 9.3 Raffle draw
- Admin clicks "Draw next" (one winner at a time; a gift with quantity 3 takes three clicks). The server picks the winner, saves it, then pushes it to `/screen/raffle`.
- Use a cryptographically secure generator (`crypto.randomInt`). **Never `Math.random`.**
- Draw without replacement among registered employees who have not already won. The `UNIQUE` constraint on `emp_id` is the backstop.
- Order: ascending gift id; each gift is drawn `quantity` times before the next. The gift list stays editable at any time, but a gift with winners can't be deleted or have its quantity cut below the winners already drawn.
- After registration closes, export the registrations CSV, compute its SHA-256 and show the entry count and hash on the big screen **before** the first draw, so the list cannot be altered afterwards.
- No absent-winner or redraw logic (see section 3).

### 9.4 Voting
- Admin sets 5 finalists, sets duration, presses Start. The server sets `opens_at = now()` and `closes_at = opens_at + duration`.
- Finalists cannot be edited after Start.
- Finalists may vote for themselves. Do not add any self-vote restriction.
- Live tallies are computed on the server and pushed to `/screen/vote` at most **once per second** (throttle).
- Employee phones show only "Vote recorded". No counts.
- At `closes_at` the server rejects further votes. The screen shows the final result. Admin can also close early.
- On close, export the votes CSV and the SHA-256 of the final tally.

### 9.5 Live screens
- Only the two big-screen pages hold an open SSE connection. Employee phones make plain short requests (keeps 800-user load light).
- Big screens are read-only. Access requires a secret token in the URL plus an allowed-IP list (configurable in `.env`).
- Each screen subscribes to its own module's channel only.

## 10. Security and data protection

- HTTPS only (Caddy). Redirect HTTP to HTTPS.
- Secrets (DB password, NIC pepper, session secret, screen tokens) live in `.env`, never in code. Provide `.env.example`.
- Database port is **not** exposed to the internet.
- VPS: SSH keys only, firewall open only on ports 22, 80, 443.
- Admin: argon2 passwords, session cookies (`HttpOnly`, `Secure`, `SameSite=Lax`), role checks on every admin route, CSRF protection for admin POSTs.
- Send security headers (helmet). Strict input validation (JSON schema on every route).
- NIC data: verification uses **only a salted/peppered hash** of the last 4 digits. The full NIC is additionally stored **encrypted** (never plain text) so admins can see and correct it; it is shown to logged-in admins only. Delete or anonymize the hashes **and** the encrypted NICs after the event. This is personal data; the owner should confirm handling with their legal/HR team.
- Vote traceability: `vote_votes` links employee ID to choice (owner's decision, for audit). Only the `auditor` role can export the file that contains employee IDs. The big screen and operators see aggregates only. Employees should be told beforehand that votes are recorded for audit.
- Employee pages: no heavy images or scripts. Poster text: "Use mobile data".

## 11. Non-functional requirements

- Handle **800 concurrent users per module** with p95 response under about 1 s on a small VPS.
- Connection pool modest (about 20 to 50).
- Zero duplicate registrations or votes under concurrent requests.
- All state survives an app restart (everything in PostgreSQL).
- Backups: database dump before the event and after each module closes; test a restore.

## 12. Testing requirements

**Automated**
- Unit: NIC normalization, hash comparison, time-window logic, secure draw without replacement.
- Integration: full raffle flow; full voting flow; window boundary (1 second before and after close); locked finalists after start.
- **Concurrency:** 50 simultaneous requests for the same employee ID must yield **exactly one success** (registration and voting, tested separately).
- **Isolation:** with raffle closed and voting open (and the reverse), each module behaves independently. A test scans that neither module imports from the other.
- **Enumeration:** wrong employee number and wrong NIC produce the same response shape.

**Load (k6, run from a separate machine or network)**
- 800 virtual users per module, each scanning, verifying and submitting.
- Rate limiting or Cloudflare will block a single-IP test. Test against the origin or whitelist the test machine.
- Repeat on the actual VPS after final code freeze.

**Manual**
- Rehearsal with about 20 real phones on mobile data.
- Big screens tested on the real projector or display.
- Backup and restore drill.

## 13. Deployment

1. Develop and test locally with Docker Compose (`http://localhost:3000`; phones on the same Wi-Fi can use `http://<pc-ip>:3000`).
2. Provision a small VPS (Ubuntu 24.04 LTS), install Docker.
3. Create a subdomain (for example `event.<company-domain>`) pointing to the VPS IP. Employees trust a company-branded address.
4. Copy the stack, set `.env`, start Compose. Caddy issues the HTTPS certificate automatically.
5. Re-run the load test on the VPS. Print QR posters (two different codes) and test-scan them.
6. Optional: Cloudflare free plan in front for DDoS protection.

## 14. Event-day runbook (write to `docs/RUNBOOK.md`)

1. Confirm the employee list, gift list and finalists are loaded. Take a backup.
2. Open raffle registration. It closes automatically after the window (default 15 min).
3. Export the registrations, show the entry count and SHA-256 on the raffle screen.
4. Run the live draw on stage: gifts in ascending id order.
5. Set duration and start voting. Watch live counts on the voting screen. It closes automatically or manually.
6. Export the votes CSV and the tally hash. Announce the result.
7. Take backups, export all logs, archive them, and delete the NIC hashes.

## 15. Build order for Claude Code

Work in this order and stop at the end of each phase for review:

1. **Scaffold:** repo, Docker Compose (app, db, caddy), env handling, migrations runner, health route.
2. **Core:** employees import, NIC normalization and verification, admin auth and roles, audit log, time-window helper, SSE hub, rate limiting.
3. **Raffle module:** config, registration (`verify` and `register`), admin section, exports with hash, draw, raffle big screen.
4. **Voting module:** finalists, config, start and close, `verify` and `cast`, live tally, voting big screen, exports.
5. **Tests:** unit, integration, concurrency, isolation.
6. **k6 scripts and docs:** load test scripts, `RUNBOOK.md`, deployment notes.

## 16. Acceptance criteria

- One app, one database. `modules/raffle` and `modules/voting` do not import each other.
- Raffle: an employee registers once; a second attempt shows "You are already registered"; registration is impossible outside the server-defined window.
- Raffle: unique winners are drawn live for every configured gift (ascending gift id, `quantity` winners each), nobody wins twice, the list hash is shown before the draw.
- Voting: an employee votes once for one of the 5 finalists; the first vote is final; phones never show counts; the big screen shows live counts.
- Voting: the duration is configurable (default 15 min); after close no votes are accepted; the tally hash is exported.
- Wrong NIC and unknown employee return the same response shape; repeated failures are rate-limited and logged.
- Concurrency test passes (exactly one success per employee under 50 simultaneous requests) for both modules.
- Both modules can be open simultaneously without interfering.
- All exports (registrations, draw results, votes, audit log) work and match the database.
