# Event-day runbook

Follow in order. Each step includes the concrete command/URL — nothing here
requires reading the code. For first-time VPS setup, see
[Docs/DEPLOYMENT.md](DEPLOYMENT.md).

Throughout: replace `https://event.yourcompany.com` with your real domain,
and `<...>` with actual values. Admin steps can be done via the browser UI
(`/admin/raffle`, `/admin/vote`) or curl — both are shown where it helps.

## Before the event (day before, or morning of)

### 1. Confirm the stack is healthy

```bash
docker compose ps                 # all three services "Up" (db "healthy")
curl https://event.yourcompany.com/api/health
# -> {"status":"ok","db":"ok"}
```

### 2. Confirm admin accounts exist

One account per role, created during deployment (see DEPLOYMENT.md step 5).
If you need to reset a password or add someone:

```bash
docker compose exec app node db/seed/create-admin.js <username> <password> raffle_operator
```

### 3. Import the real employee master list

Log in at `https://event.yourcompany.com/admin/login`, go to the dashboard,
and upload the CSV (`emp_id,name,dept,nic` — full NIC, the app extracts and
hashes the last 4 digits itself). The import result lists every row that
failed validation by name/reason — **check this list**, don't just glance at
the success count. Fix and re-upload any bad rows (re-uploading is safe;
existing employee IDs are updated in place, not duplicated).

### 4. Configure the raffle gift list

At `/admin/raffle`: enter exactly 10 normal gift names and 15 premium gift
names, then "Save gift list". This is only editable while the raffle is
still in `draft` status — double check the names before opening.

### 5. Configure the voting finalists

At `/admin/vote`: enter the 5 finalists (name + song), "Save finalists".
Like the gift list, this locks once voting starts — this is your last
chance to fix a typo in a finalist's name.

### 6. Take a pre-event backup

```bash
docker compose exec -T db pg_dump -U event_app_owner -d annual_event \
  > backup-pre-event-$(date +%Y%m%d-%H%M).sql
```

### 7. Set up the big screens

On the venue laptop(s) connected to the projector:
1. Confirm its IP is in `SCREEN_ALLOWED_IPS` in `.env` on the VPS (update +
   `docker compose restart app` if the venue network assigns a new IP on
   the day — check with `curl ifconfig.me` from that laptop).
2. Get the screen tokens: `docker compose exec app printenv SCREEN_TOKEN_RAFFLE`
   (and `_VOTE`).
3. Open in a browser, full-screen:
   - `https://event.yourcompany.com/screen/raffle?token=<raffle token>`
   - `https://event.yourcompany.com/screen/vote?token=<vote token>`
4. Confirm each shows a countdown placeholder (`--:--`) and no errors.
   These pages are read-only and never shown to employees.

### 8. Test-scan both QR posters

From a phone on **mobile data** (not venue Wi-Fi), confirm the raffle QR
opens `/raffle` and the voting QR opens `/vote`, both showing "not open yet."

---

## Running the raffle

### 9. Open registration

At `/admin/raffle`, set the window length (default 15 min — change if you
want a different duration for this event) and click "Open". Or via curl:

```bash
curl -sk -b cookies.txt -H "Content-Type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"windowMinutes": 15}' https://event.yourcompany.com/admin/api/raffle/open
```

Announce the QR code / show it on screen. The raffle screen now shows a live
countdown and entry count. **The server enforces the window regardless of
what's displayed** — even if you leave the QR up, registration stops
accepting new entries the moment the window closes.

### 10. Let it run, then close

It closes automatically at the end of the window. To close early instead:

```bash
curl -sk -b cookies.txt -H "x-csrf-token: $CSRF" -X POST \
  https://event.yourcompany.com/admin/api/raffle/close
```

### 11. Seal the list — do this before the first draw

This exports the registration list, computes its SHA-256, and pushes the
entry count + hash to the big screen, so the audience sees proof the list
can't be altered before drawing starts:

```bash
curl -sk -b cookies.txt -o registrations.csv \
  https://event.yourcompany.com/admin/api/raffle/registrations/export
```

The raffle screen now shows the entry count and hash. Read the hash out
loud or leave it on screen — this is the audit trail's anchor point.

### 12. Draw, live, on stage

Click "Draw next winner" on `/admin/raffle` once per gift — **normal gifts
are drawn first automatically, premium gifts last** (the server enforces
this order regardless of click order). Each draw:
- Picks cryptographically at random from remaining eligible entrants (no
  repeat winners, enforced at the database level).
- Immediately animates on the big screen.

An absent winner is still a winner — there is no redraw. They collect their
gift later (gift collection itself isn't tracked by this app).

Once every registered entrant has won (which may be before all 25 gifts are
drawn, if fewer than 25 people registered), further draws return "No
eligible entrants remain" — this is expected, not an error.

### 13. Export the draw results

```bash
curl -sk -b cookies.txt -o raffle_results.csv \
  https://event.yourcompany.com/admin/api/raffle/results/export
```

---

## Running the voting

### 14. Set duration and start

At `/admin/vote`: set the duration (default 15 min), then "Start voting".
Starting locks the finalist list and sets the live window (server time,
same enforcement guarantee as the raffle).

```bash
curl -sk -b cookies.txt -H "Content-Type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"durationMinutes": 15}' https://event.yourcompany.com/admin/api/vote/config
curl -sk -b cookies.txt -H "x-csrf-token: $CSRF" -X POST \
  https://event.yourcompany.com/admin/api/vote/start
```

Announce the QR code. Employee phones only ever show "Vote recorded" — they
never see counts. The voting screen shows live per-finalist bars, updated
from the server at most once a second.

### 15. Let it run, then close

Automatic at the end of the window, or close early the same way as the
raffle (`POST /admin/api/vote/close`). Once closed, no further votes are
accepted — the screen freezes on the final tally.

### 16. Export results and announce

**Only the `auditor` role can access this export** (it contains employee
IDs linked to each vote — the raffle exports don't have this extra
restriction). Log in as an auditor account:

```bash
curl -sk -b auditor_cookies.txt -o votes.csv \
  https://event.yourcompany.com/admin/api/vote/results/export
```

The response also includes `X-Total-Votes` and `X-SHA-256` headers (hash of
the final tally) — same audit-trail purpose as the raffle's sealed-list
hash. Announce the winner from the big screen's final tally.

---

## After the event

### 17. Take a final backup

```bash
docker compose exec -T db pg_dump -U event_app_owner -d annual_event \
  > backup-post-event-$(date +%Y%m%d-%H%M).sql
```

Test the restore somewhere safe before relying on it (see "Restore drill"
below) — a backup you haven't tested is a hope, not a backup.

### 18. Export all logs

```bash
# Full audit log (every registration, vote, draw, login, and failed
# attempt, with timestamps and IPs):
curl -sk -b auditor_cookies.txt -o audit_log.csv \
  https://event.yourcompany.com/admin/api/audit/export

# Already have these from steps 13 and 16:
# raffle_results.csv, votes.csv (and registrations.csv from step 11)
```

Archive `backup-post-event-*.sql`, `audit_log.csv`, `raffle_results.csv`,
`registrations.csv`, and `votes.csv` together somewhere durable (not just on
the VPS).

### 19. Delete or anonymize the NIC hashes

This is personal data (requirement 10) — **confirm the retention approach
with your legal/HR team** before running this; the SQL below is a starting
point, not a policy decision. It preserves the `employees` rows (so the
raffle/vote history stays intact and FK-valid) but destroys the ability to
ever verify against the original NIC:

```bash
docker compose exec db psql -U event_app_owner -d annual_event -c \
  "UPDATE employees SET nic_last4_hash = 'redacted-post-event';"
```

### 20. Wind down

- Rotate the screen tokens and admin passwords if you plan to reuse this
  deployment for a future event (`SCREEN_TOKEN_RAFFLE`/`_VOTE` in `.env`,
  then `docker compose restart app`; re-run `create-admin.js` for new
  passwords).
- Otherwise, decommission the VPS once the archive from step 18 is safely
  stored elsewhere.

---

## Backup and restore drill

Do this **before** the event, against a disposable copy — never test a
restore against the live event database.

```bash
# Take a dump (same command as steps 6/17)
docker compose exec -T db pg_dump -U event_app_owner -d annual_event > test-backup.sql

# Restore into a throwaway database to prove the dump is valid
docker compose exec -T db psql -U event_app_owner -c "CREATE DATABASE restore_test;"
docker compose exec -T db psql -U event_app_owner -d restore_test < test-backup.sql
docker compose exec -T db psql -U event_app_owner -d restore_test -c "SELECT count(*) FROM employees;"
# then clean up:
docker compose exec -T db psql -U event_app_owner -c "DROP DATABASE restore_test;"
```

## Rehearsal checklist (do this once, a few days before)

- [ ] ~20 real phones on mobile data, scanning both QR codes and completing
      the full flow (verify → register / verify → cast).
- [ ] Big screens tested on the actual projector/display, not just a laptop
      screen — check readability from the back of the room.
- [ ] Backup and restore drill (above) completed successfully.
- [ ] Load test re-run on the real VPS (Docs/DEPLOYMENT.md step 6).
- [ ] Confirm `SCREEN_ALLOWED_IPS` matches whatever device will actually run
      the screens on the day.
