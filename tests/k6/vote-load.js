// Load test for the voting module (requirement 12): 800 virtual users, each
// scanning (loading status), verifying, and casting a vote — matching the
// real event flow. Run from a separate machine/network, against the origin
// directly (not through Cloudflare).
//
// Prerequisites:
//   1. Generate + import N test employees (must match VUS below) — same
//      step as raffle-load.js, employees are shared across both modules:
//        node db/seed/gen-load-test-employees.js 800 > employees.csv
//        curl -sk -b cookies.txt -H "Content-Type: text/csv" -H "x-csrf-token: $CSRF" \
//          --data-binary @employees.csv https://<host>/admin/api/employees/import
//   2. As vote_operator: configure the 5 finalists, set a duration long
//      enough to cover the test's duration, and start voting.
//   3. Add this machine's IP to RATE_LIMIT_ALLOWLIST in .env and restart
//      the app (see the "Load testing" section of docs/RUNBOOK.md).
//
// NOTE: voting is one-vote-per-employee for the life of the voting session
// (first vote is final — there's no "undo"). Re-running this script against
// the SAME still-open voting session with the SAME employees will make
// verify_success_rate/cast_success_rate crash to near-zero, because most of
// them already voted last time — that's the app correctly rejecting repeat
// voters, not a bug. For a second full-scale run, either close voting,
// reconfigure fresh finalists and start again, or generate a new employee
// range (e.g. `gen-load-test-employees.js` with an offset) that hasn't
// voted yet.
//
// Run:
//   BASE_URL=https://event.example.com VUS=800 k6 run tests/k6/vote-load.js
//   (add --insecure-skip-tls-verify if testing against a self-signed cert)
//
// IMPORTANT: the empId/last4 scheme below must match
// db/seed/gen-load-test-employees.js exactly — see the comment there.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://localhost';
const VUS = Number(__ENV.VUS || 800);

const verifySuccessRate = new Rate('verify_success_rate');
const castSuccessRate = new Rate('cast_success_rate');

export const options = {
  scenarios: {
    voting: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '5m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'], // requirement 11: p95 under ~1s
    http_req_failed: ['rate<0.01'],
    verify_success_rate: ['rate>0.99'],
    cast_success_rate: ['rate>0.99'],
  },
};

function employeeFor(vu) {
  const empId = 'LT' + String(vu).padStart(4, '0');
  const last4 = String(1000 + vu).slice(-4);
  return { empId, last4 };
}

function safeJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

export function setup() {
  const res = http.get(`${BASE_URL}/vote/api/status`);
  const body = safeJson(res);
  if (!body || !body.isOpen) {
    throw new Error(
      `Voting is not open (status: ${body?.status ?? 'unknown'}). ` +
        'Configure finalists and start voting via the admin panel before running this load test.'
    );
  }
}

export default function () {
  const { empId, last4 } = employeeFor(__VU);
  const headers = { 'Content-Type': 'application/json' };

  // 1. Load the page's status, like a phone landing on /vote.
  const statusRes = http.get(`${BASE_URL}/vote/api/status`);
  check(statusRes, { 'status check ok': (r) => r.status === 200 });

  sleep(Math.random() * 1.5 + 0.2); // time to read the page and type employee number

  // 2. Verify — the response carries the 5 finalists, like the real flow.
  const verifyRes = http.post(`${BASE_URL}/vote/api/verify`, JSON.stringify({ empId, last4 }), { headers });
  const verifyBody = safeJson(verifyRes);
  verifySuccessRate.add(verifyBody?.ok === true);
  check(verifyRes, { 'verify responded': (r) => [200, 401, 403, 409].includes(r.status) });

  if (!verifyBody?.ok || !verifyBody.finalists?.length) return;

  sleep(Math.random() * 2 + 0.5); // time to read the finalist list and pick one

  // 3. Cast — spread votes across finalists so the tally isn't all on one bar.
  const finalist = verifyBody.finalists[__VU % verifyBody.finalists.length];
  const castRes = http.post(
    `${BASE_URL}/vote/api/cast`,
    JSON.stringify({ empId, last4, finalistId: finalist.id }),
    { headers }
  );
  const castBody = safeJson(castRes);
  castSuccessRate.add(castBody?.ok === true);
  check(castRes, { 'cast responded': (r) => [200, 400, 401, 403, 409].includes(r.status) });
}
