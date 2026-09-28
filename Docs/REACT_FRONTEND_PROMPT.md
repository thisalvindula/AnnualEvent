# Prompt: Rebuild the frontend in React + Vite

Paste everything below this line to Claude Code (in VS Code, inside this repo) as one task.

---

## Context

This repo is a working Node.js + Fastify + PostgreSQL app for a company's annual
employee event (raffle draw + singing-competition voting). Read `Docs/REQUIREMENTS.md`,
`Docs/RUNBOOK.md`, `Docs/DEPLOYMENT.md`, and `Docs/TESTING.md` fully before changing
anything — they describe rules that still apply.

**Goal of this task: replace the frontend (currently server-rendered HTML strings +
vanilla JS files) with React, built via Vite. The backend (Fastify routes, services,
repos, DB schema, migrations, audit log, rate limiting, session/CSRF logic, draw
algorithm, Docker/Caddy setup) stays as-is except for the small, explicitly listed
additions below. Do not restructure or rewrite backend logic beyond what's needed to
serve the new frontend.**

## Hard constraints — do not violate these

1. **Module isolation is sacred.** `modules/raffle` and `modules/voting` must never
   import from each other, in the backend OR in the new frontend. There is an existing
   test, `tests/unit/isolation-imports.test.js`, that scans `app/modules/*` for
   cross-references. Extend it (or add a sibling test) to scan the new frontend source
   directories the same way, so a raffle component can never import a voting component
   and vice versa.

2. **Employee-facing pages must stay extremely light.** The `/raffle` and `/vote` pages
   are opened by ~800 employees on mobile data inside a 15-minute window. Each page has
   exactly two inputs (employee number, last-4-digits-of-NIC), a confirm step, and a
   result message. **No animations, no transitions, no confetti, no decorative motion
   on these two pages.** Minimal, clean styling only (reuse the existing `theme.css`
   design tokens where possible).

   To hit this weight target while still using React everywhere for code
   consistency: **alias `react` and `react-dom` to `preact/compat` in the Vite config**
   (`resolve.alias`) for the whole project, or at minimum for the raffle/vote employee
   bundles. This lets you write normal React/JSX/hooks code, but ship Preact's ~4 KB
   runtime instead of React's ~45 KB one. Confirm the final gzipped JS for `/raffle`
   and `/vote` is well under 50 KB total (matching the original requirement in
   `Docs/REQUIREMENTS.md` section 5), ideally under 15–20 KB.

3. **The two big-screen displays (`/screen/raffle`, `/screen/vote`) are the one place
   rich animation belongs** — modern, animation-rich "prize ceremony" style visuals
   (confetti, reveal animations, live vote bars). No mobile-data budget applies here;
   these run on a laptop plugged into a projector/TV. Full React (or Preact, your
   choice, but keep it consistent with the rest of the app) is fine here.

4. **Screen access control must not weaken.** Today `GET /screen/raffle` and
   `GET /screen/vote` are gated server-side by `requireScreenAccess` (a secret token in
   the query string + an optional IP allowlist, in `app/core/screenAuth.js`) *before*
   any HTML is sent. When you move these to Vite-built React apps, **Fastify must still
   serve the built `index.html` for these routes behind that same `requireScreenAccess`
   preHandler** — don't turn them into statically-served files anyone can fetch
   directly. The SSE stream endpoints (`/screen/raffle/stream`, `/screen/vote/stream`)
   already enforce this separately and must keep doing so.

5. **Admin pages need two small new read APIs, nothing more.** Currently
   `app/modules/raffle/admin.js` and `app/modules/voting/admin.js` build the CSRF
   token and current status/config directly into server-rendered HTML. Add JSON
   endpoints so React can fetch this instead:
   - `GET /admin/api/csrf` → `{ csrfToken }` (reuse `reply.generateCsrf()`)
   - `GET /admin/api/me` → `{ username, role }` from `request.adminSession`, 401 if
     not logged in
   - `GET /admin/api/raffle/detail` → status, entry count, configured gifts (extend
     existing `service.getStatus()` / `repo.getGifts()` — don't change their logic)
   - `GET /admin/api/vote/detail` → status, finalists, duration (same idea, voting
     module)
   Keep these behind the same `requireRole(...)` checks the existing HTML routes use.
   All state-changing admin endpoints already exist and already return JSON
   (`/admin/api/raffle/...`, `/admin/api/vote/...`) — reuse them unchanged from React;
   don't duplicate them.

6. **Do not touch:** DB schema/migrations, `service.js`/`repo.js` business logic in
   either module, the draw algorithm, the audit log (`app/core/audit`), NIC
   verification (`app/core/nic.js`), time-window logic, rate limiting, session/cookie
   logic, or the Postgres/Caddy/Docker Compose architecture — beyond adding the build
   step described below.

## What to build

A Vite multi-page React app with **one entry point per page**, so each bundle only
ships the code that page needs (mirrors the backend module isolation):

```
frontend/
  raffle/
    register/     -> employee registration page (2 fields, no animation)
    screen/       -> big-screen live draw display (full animation)
  voting/
    vote/         -> employee voting page (verify + pick finalist, no animation)
    screen/       -> big-screen live vote display (full animation)
  admin/
    login/
    dashboard/     -> shared admin shell, or split raffle-admin / vote-admin if that's
                       cleaner — your call, as long as it doesn't create a raffle<->vote
                       frontend dependency
  shared/          -> only truly shared pieces: theme tokens, the CSRF-fetch helper,
                       the SSE-hook (screens), tiny UI primitives. Nothing here should
                       import from raffle/ or voting/, only the reverse.
  vite.config.js
```

Guidelines:
- Use Vite's [multi-page app mode](https://vite.dev/guide/build.html#multi-page-app)
  (multiple `rollupOptions.input` entries) so each page builds to its own small
  HTML+JS+CSS output.
- Keep the existing `app/core/public/theme.css` design tokens (or port them to CSS
  variables/modules used by both React and any remaining vanilla pages) so the visual
  language doesn't drift.
- Employee pages (`raffle/register`, `voting/vote`): plain functional components,
  local `useState` for form state, `fetch` to the existing `/raffle/api/*` and
  `/vote/api/*` endpoints (unchanged). No animation libraries, no CSS transitions
  beyond a basic focus/error state.
- Screen pages (`raffle/screen`, `voting/screen`): a small custom hook wrapping
  `EventSource` against `/screen/raffle/stream` / `/screen/vote/stream` (reading the
  `token` query param the same way the current `public/screen.js` files do), feeding
  state to animated components (confetti reveal, winner card, live vote bars). Port
  the visual ideas from the existing `app/core/public/confetti.js` and
  `modules/*/public/screen.js`, but rebuild as React components — don't just wrap the
  old vanilla script.
- Admin pages: fetch `/admin/api/csrf`, `/admin/api/me`, and the new `*/detail`
  endpoints on load; reuse the existing action endpoints for open/close/draw/export
  etc., sending `x-csrf-token` the same way `app/modules/*/public/admin.js` does today.
- In dev, configure Vite's `server.proxy` to forward `/raffle/api`, `/vote/api`,
  `/admin`, `/screen` (for the SSE streams and the gated screen HTML) to the Fastify
  dev server, so `npm run dev` (Fastify) and the Vite dev server can run side by side
  against the same backend.
- Because React 18 `StrictMode` double-invokes effects in dev, make sure the
  `EventSource` hook properly closes the connection in its cleanup function so you
  don't leak duplicate SSE connections while developing the screens.

## Build & deploy changes

- Add Vite + React + Preact (`preact`, and use `preact/compat` aliasing — do not
  install `react`/`react-dom` as the actual runtime if aliasing) as dependencies.
- Add an npm script, e.g. `"build:frontend": "vite build"`, producing static output
  (e.g. `frontend/dist/`).
- Update `app/server.js`'s `@fastify/static` registrations (or add new ones) to serve
  the built per-page bundles at sensible prefixes, and update each page route
  (`/raffle`, `/vote`, `/admin`, `/admin/raffle`, `/admin/vote`, `/screen/raffle`,
  `/screen/vote`) to serve the corresponding built `index.html` instead of the current
  inline HTML string — keeping every existing `preHandler` (auth, screen token/IP
  check) exactly where it is today.
- Update the `Dockerfile` to run `npm run build:frontend` during the image build (a
  multi-stage build: a node build stage that runs Vite, then copy `frontend/dist`
  into the final runtime stage alongside `app` and `db`).
- Static built assets (hashed filenames) can be cached long-term; the HTML shells for
  each page should not be cached (or cached very briefly), so updates roll out
  cleanly.
- `docker-compose.yml`, `Caddyfile`, and the Postgres service do not need to change.

## Testing

- Extend `tests/unit/isolation-imports.test.js` (or add a new test file) to also scan
  the new `frontend/raffle/` and `frontend/voting/` directories for cross-imports,
  exactly like it does for `app/modules/`.
- Add a simple bundle-size check (even a manual note in `Docs/TESTING.md`, or a small
  script) confirming `frontend/raffle/register` and `frontend/voting/vote` gzipped
  output stays under the target from constraint #2 above.
- Manually re-walk the existing flow in `Docs/Steps.txt` end-to-end (register →
  close → seal → draw on the raffle screen; verify → vote → live bars on the voting
  screen; admin login/logout; audit CSV export) against the React frontend before
  calling this done.
- Run the existing `npm run test:unit` and `npm run test:integration` suites — they
  should all still pass unchanged, since no backend business logic is changing.

## Deliverable checklist

- [ ] Vite multi-page React app under `frontend/`, one entry per page, Preact-aliased
- [ ] Employee pages (`/raffle`, `/vote`): 2 inputs + confirm + result, no animation,
      confirmed bundle size under the target
- [ ] Screen pages: animated, React-based, still gated server-side by
      `requireScreenAccess` before the HTML is served
- [ ] Admin pages: fetch CSRF/session/detail from new small JSON endpoints, reuse all
      existing action endpoints unchanged
- [ ] New endpoints added: `GET /admin/api/csrf`, `GET /admin/api/me`,
      `GET /admin/api/raffle/detail`, `GET /admin/api/vote/detail` — all behind the
      same role checks as today's HTML routes
- [ ] `tests/unit/isolation-imports.test.js` extended to cover the frontend, and still
      passing (no raffle<->voting frontend imports)
- [ ] All existing unit/integration tests still pass unmodified
- [ ] Dockerfile updated (multi-stage build including `vite build`); docker-compose
      and Caddyfile untouched
- [ ] `Docs/REQUIREMENTS.md` section 5 ("Frontend" row) updated to reflect the React +
      Vite + Preact-alias decision, so the documented stack matches reality
