// Every other integration test calls the raffle/voting service layer
// directly, bypassing Fastify entirely — so CSRF protection, rate limiting,
// and /api/health are never actually exercised at the HTTP layer they run
// in production. These tests use buildApp() + app.inject() to go through
// the real plugin chain instead.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../app/buildApp.js';
import { closeAllConnections } from './helpers.js';

let app;

before(async () => {
  app = await buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
  await closeAllConnections();
});

test('GET /api/health reports ok against the real database', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', db: 'ok' });
});

test('an admin mutation without a CSRF token is rejected', async () => {
  // No login, no csrf cookie/token at all — csrfProtection runs as an
  // onRequest hook, ahead of the requireRole preHandler, so this is
  // rejected before auth is even checked.
  const res = await app.inject({
    method: 'POST',
    url: '/admin/api/raffle/open',
    payload: { windowMinutes: 15 },
  });
  assert.equal(res.statusCode, 403);
});

test('the global rate limiter returns 429 past its threshold', async () => {
  // Global limit is 300 req/min per IP (app/buildApp.js); injected requests
  // all share the same default IP, so this proves the plugin is actually
  // wired up end-to-end, not just configured. Assumes RATE_LIMIT_ALLOWLIST
  // doesn't include the test runner's IP (it's empty by default — see
  // .env.example — since it's normally only set for a k6 load-test run).
  let last;
  for (let i = 0; i < 301; i++) {
    last = await app.inject({ method: 'GET', url: '/raffle/api/status' });
    if (last.statusCode === 429) break;
  }
  assert.equal(last.statusCode, 429);
  assert.ok(hasRateLimitHeaders(last), 'expected rate-limit headers on the 429 response');
});

function hasRateLimitHeaders(res) {
  return res.headers['retry-after'] !== undefined || res.headers['x-ratelimit-remaining'] !== undefined;
}
