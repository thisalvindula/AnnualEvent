import { appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';

// Event-day watchdog: polls the app's own health/diagnostics endpoints and
// writes clearly-flagged lines to a dedicated log file. With no external
// monitoring service in the picture, "alerting" here means a human has this
// file tailed (`tail -f`) on a terminal for the duration of the live event —
// see Docs/RUNBOOK.md, "Before the event". Runs on the host, not inside the
// app container, so an app crash/restart doesn't take the watchdog down too.
//
// Usage: node scripts/watchdog.js
// Env vars (all optional): WATCHDOG_PORT (default 3000), WATCHDOG_INTERVAL_MS
// (default 10000), WATCHDOG_LOG (default ./watchdog.log), WATCHDOG_ALERT_EMAIL
// (best-effort `mail` on a healthy->unhealthy transition, if the host has
// outbound mail configured — the log file is the real requirement, not this).

const PORT = process.env.WATCHDOG_PORT ?? '3000';
const INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS ?? 10000);
const LOG_PATH = process.env.WATCHDOG_LOG ?? './watchdog.log';
const ALERT_EMAIL = process.env.WATCHDOG_ALERT_EMAIL;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let lastHealthy = true;

function write(line) {
  const stamped = `${line}\n`;
  process.stdout.write(stamped);
  try {
    appendFileSync(LOG_PATH, stamped);
  } catch (err) {
    process.stderr.write(`[watchdog] could not write to ${LOG_PATH}: ${err.message}\n`);
  }
}

function notify(subject, body) {
  if (!ALERT_EMAIL) return;
  execFile('mail', ['-s', subject, ALERT_EMAIL], (err, _stdout, stderr) => {
    if (err) process.stderr.write(`[watchdog] mail notify failed: ${stderr || err.message}\n`);
  }).stdin?.end(body);
}

async function fetchJson(path, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function tick() {
  const now = new Date().toISOString();

  let health;
  try {
    health = await fetchJson('/api/health');
  } catch (err) {
    lastHealthy = false;
    write(`[ALERT ${now}] could not reach ${BASE_URL}/api/health: ${err.message}`);
    return;
  }

  if (!health.ok || health.body.status !== 'ok') {
    if (lastHealthy) notify('AnnualEvent app degraded', `/api/health returned ${health.status}: ${JSON.stringify(health.body)}`);
    lastHealthy = false;
    write(`[ALERT ${now}] /api/health returned ${health.status} (${JSON.stringify(health.body)})`);
    return;
  }

  if (!lastHealthy) {
    notify('AnnualEvent app recovered', '/api/health is ok again.');
    write(`[OK ${now}] health recovered`);
  }
  lastHealthy = true;

  let sse = { raffle: '?', vote: '?' };
  try {
    const sseRes = await fetchJson('/internal/sse-status');
    if (sseRes.ok) sse = sseRes.body;
  } catch {
    // Diagnostics endpoint failing doesn't itself mean the app is down —
    // health check above already covers that. Just note it and move on.
  }

  write(`[OK ${now}] health=ok db=ok raffle_screens=${sse.raffle} vote_screens=${sse.vote}`);
}

write(`[watchdog] starting — polling ${BASE_URL} every ${INTERVAL_MS}ms, logging to ${LOG_PATH}`);
tick();
setInterval(tick, INTERVAL_MS);
