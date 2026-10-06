// Load test for the raffle module (requirement 12): 800 virtual users, each
// scanning (loading status), verifying, and registering — matching the real
// event flow. Run from a separate machine/network, against the origin
// directly (not through Cloudflare, which would rate-limit or block this).
//
// Prerequisites:
//   1. Generate + import N test employees (must match VUS below):
//        node db/seed/gen-load-test-employees.js 800 > employees.csv
//        curl -sk -b cookies.txt -H "Content-Type: text/csv" -H "x-csrf-token: $CSRF" \
//          --data-binary @employees.csv https://<host>/admin/api/employees/import
//   2. As raffle_operator: configure the gift list and open registration
//      with a window long enough to cover the test's duration.
//   3. Add this machine's IP to RATE_LIMIT_ALLOWLIST in .env and restart the
//      app (see the "Load testing" section of docs/RUNBOOK.md) — otherwise
//      the global rate limiter will reject most requests, since they all
//      come from one IP here (real employees each have their own phone/IP).
//
// Run:
//   BASE_URL=https://event.example.com VUS=800 k6 run tests/k6/raffle-load.js
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
const registerSuccessRate = new Rate('register_success_rate');

export const options = {
  scenarios: {
    raffle_registration: {
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
    register_success_rate: ['rate>0.99'],
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
  const res = http.get(`${BASE_URL}/raffle/api/status`);
  const body = safeJson(res);
  if (!body || !body.isOpen) {
    throw new Error(
      `Raffle is not open (status: ${body?.status ?? 'unknown'}). ` +
        'Configure gifts and open registration via the admin panel before running this load test.'
    );
  }
}

export default function () {
  const { empId, last4 } = employeeFor(__VU);
  const headers = { 'Content-Type': 'application/json' };

  // 1. Load the page's status, like a phone landing on /raffle.
  const statusRes = http.get(`${BASE_URL}/raffle/api/status`);
  check(statusRes, { 'status check ok': (r) => r.status === 200 });

  sleep(Math.random() * 1.5 + 0.2); // time to read the page and type employee number

  // 2. Verify.
  const verifyRes = http.post(`${BASE_URL}/raffle/api/verify`, JSON.stringify({ empId, last4 }), { headers });
  const verifyBody = safeJson(verifyRes);
  verifySuccessRate.add(verifyBody?.ok === true);
  check(verifyRes, { 'verify responded': (r) => [200, 401, 403].includes(r.status) });

  if (!verifyBody?.ok) return; // can't proceed to register without a successful verify

  sleep(Math.random() * 1 + 0.2); // time to tap "confirm"

  // 3. Register.
  const registerRes = http.post(`${BASE_URL}/raffle/api/register`, JSON.stringify({ empId, last4 }), { headers });
  const registerBody = safeJson(registerRes);
  registerSuccessRate.add(registerBody?.ok === true);
  check(registerRes, { 'register responded': (r) => [200, 401, 403, 409].includes(r.status) });
}
