# Deployment notes

How to take this from "runs on my laptop" to "runs on the VPS for the real
event." For local development, see [Docs/TESTING.md](TESTING.md). For
running the event itself, see [Docs/RUNBOOK.md](RUNBOOK.md).

## 1. Provision the VPS

- Ubuntu 24.04 LTS, smallest size that gives you ~2 vCPU / 2-4 GB RAM (the
  app is intentionally lightweight — no load balancer or cluster needed for
  ~800 concurrent users per module).
- Install Docker + Docker Compose plugin:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # log out/in after this
  ```
- **SSH**: key-based auth only. Disable password auth in `/etc/ssh/sshd_config`
  (`PasswordAuthentication no`), then `sudo systemctl restart ssh`.
- **Firewall**: only 22, 80, 443.
  ```bash
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw enable
  ```

## 2. DNS

Point a subdomain (e.g. `event.yourcompany.com`) at the VPS's IP address (an
`A` record). Employees trust a company-branded address more than a raw IP or
generic hosting domain — use the subdomain on the QR posters, not the IP.

## 3. Copy the stack and configure secrets

```bash
git clone <your repo> annual-event-app   # or scp the project directory
cd annual-event-app
cp .env.example .env
```

Edit `.env`:
- `DOMAIN` → your real subdomain (e.g. `event.yourcompany.com`). Caddy uses
  this to request a trusted Let's Encrypt certificate automatically — no
  manual cert steps needed.
- Generate real secrets for everything marked `change_me_...`:
  ```bash
  openssl rand -hex 32   # SESSION_SECRET, NIC_PEPPER
  openssl rand -hex 24   # POSTGRES_PASSWORD, APP_DB_PASSWORD
  openssl rand -hex 16   # SCREEN_TOKEN_RAFFLE, SCREEN_TOKEN_VOTE
  ```
  Update `MIGRATION_DATABASE_URL` / `DATABASE_URL` to match whatever
  `POSTGRES_PASSWORD` / `APP_DB_PASSWORD` you generated.
- `SCREEN_ALLOWED_IPS` → the actual public IP(s) of the venue/admin laptop
  that will display the big screens. Find it with `curl ifconfig.me` on that
  laptop. Update this closer to the event once you know which device/network
  will run the screens.
- Leave `RATE_LIMIT_ALLOWLIST` empty except during a deliberate load test
  (see section 6 below).

**Never commit `.env`.** It's already gitignored.

## 4. Start the stack

```bash
docker compose up -d --build
docker compose logs app --tail 20   # confirm migrations applied, server listening
curl https://event.yourcompany.com/api/health
```

Caddy issues the HTTPS certificate automatically on first request to the
real domain — this needs port 80/443 reachable from the internet (for the
ACME HTTP-01 challenge) and DNS already pointing at the VPS.

## 5. Create admin accounts

Run once per operator, inside the app container (there is deliberately no
HTTP route for this — see the comment in `db/seed/create-admin.js`):

```bash
docker compose exec app node db/seed/create-admin.js <username> <password> raffle_operator
docker compose exec app node db/seed/create-admin.js <username> <password> vote_operator
docker compose exec app node db/seed/create-admin.js <username> <password> auditor
```

Use strong, unique passwords (12+ characters, the script enforces this
minimum). Store them in your team's password manager, not in chat.

## 6. Re-run the load test on the real VPS

Do this after final code freeze, from a **separate machine** (your laptop,
not the VPS itself):

1. Generate and import ~800 test employees (see `tests/k6/raffle-load.js`
   and `tests/k6/vote-load.js` for the exact steps).
2. Add your test machine's public IP to `RATE_LIMIT_ALLOWLIST` in `.env` on
   the VPS, then `docker compose restart app`. Without this, the global
   rate limiter (300 req/min per IP) will reject most of the load test's
   traffic, since it all comes from one IP — real employees each use their
   own phone.
3. Run both k6 scripts against `https://event.yourcompany.com`.
4. Check the thresholds pass (p95 < 1s, <1% failed requests) — see each
   script's `options.thresholds`.
5. **Afterward**: clear `RATE_LIMIT_ALLOWLIST` back to empty and
   `docker compose restart app`. Then wipe the test data:
   ```bash
   docker compose down -v && docker compose up -d --build
   ```
   (this also clears the real event's data if any was entered — only do
   this as part of test cleanup, well before the actual event, never on
   event day itself.)

## 7. Print and test the QR posters

- Raffle QR → `https://event.yourcompany.com/raffle`
- Voting QR → `https://event.yourcompany.com/vote`
- Test-scan both from a phone on mobile data (not venue Wi-Fi) before
  printing final posters, and again on the morning of the event.
- Poster text should include "Use mobile data" (requirement 10).

## 8. Optional: Cloudflare in front

The free plan adds DDoS protection. If you use it:
- Set Cloudflare to "Full (strict)" SSL mode (Caddy already terminates
  HTTPS with a real cert, so this validates end-to-end).
- For the load test in step 6, either point k6 at the origin VPS IP
  directly (bypassing Cloudflare) or temporarily allowlist the test
  machine's IP in Cloudflare too — otherwise Cloudflare's own rate limiting
  will interfere independently of `RATE_LIMIT_ALLOWLIST`.

## Two-instance option (only if one small VPS isn't enough)

The non-goals in `Docs/REQUIREMENTS.md` explicitly say one instance is
expected to be enough, but if you do need to scale: `docker compose up -d
--scale app=2` works as-is, since all state lives in Postgres (not in the
app process) — the one exception is the in-memory per-employee NIC lockout
tracker (`app/core/ratelimit.js`) and the SSE big-screen connections
(`app/core/sse-hub.js`), both scoped to a single process. With 2+ instances,
an employee's lockout counter and a screen's SSE connection would only be
visible to whichever instance handled that request. Caddy's default
round-robin would need `lb_policy ip_hash` (or similar sticky routing) for
the two screen routes at minimum; the lockout tracker would just be weaker
(effectively divided across instances) unless moved to a shared store. This
is real added complexity — confirm it's actually needed (i.e. the load test
in step 6 actually fails on one instance) before taking it on.
