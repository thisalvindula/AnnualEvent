// Shared fixtures for the integration suite. Not a test file itself
// (doesn't match *.test.js, so the test runner won't try to execute it).
//
// Integration tests exercise the real service/repo layer against the real
// dockerized Postgres, using the same restricted app_runtime connection the
// app itself uses (core/db.js) — so a passing test also proves the DB
// grants (INSERT/SELECT-only on audit_log, no UPDATE/DELETE on votes, etc.)
// are sufficient for the app to actually function.
//
// Resetting fixture state between test files needs MORE privilege than
// app_runtime has (it can't TRUNCATE, and its DELETE on registrations/
// draw-results/votes only exists via the password-gated reset() service
// calls, not raw SQL). So resets here use a separate connection with the
// schema-owner credentials, kept completely separate from the
// service-under-test's own connection pool.

import pg from 'pg';
import argon2 from 'argon2';
import 'dotenv/config';
import { pool as appPool } from '../../app/core/db.js';
import { importEmployees } from '../../app/core/employees/index.js';

const ownerClient = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
let ownerConnected = false;

async function ensureOwnerConnected() {
  if (!ownerConnected) {
    await ownerClient.connect();
    ownerConnected = true;
  }
}

/** Wipes every table the app writes to and resets both module configs to 'draft'. */
export async function resetDatabase() {
  await ensureOwnerConnected();
  await ownerClient.query(`
    TRUNCATE raffle_draw_results, raffle_registrations, raffle_gifts,
             vote_votes, vote_finalists, audit_log, employees
    RESTART IDENTITY CASCADE
  `);
  await ownerClient.query(
    `UPDATE raffle_config SET status = 'draft', opens_at = NULL, closes_at = NULL WHERE id = 1`
  );
  await ownerClient.query(
    `UPDATE vote_config SET status = 'draft', opens_at = NULL, closes_at = NULL, duration_minutes = 15 WHERE id = 1`
  );
}

/**
 * Test-only: forces one module's config back to 'draft', bypassing the
 * service layer's one-way draft->open->closed guard. Used solely to
 * construct specific state combinations (e.g. "raffle open, voting closed"
 * *and* "voting open, raffle closed" within a single isolation test) that
 * the real one-shot-per-event lifecycle wouldn't otherwise allow revisiting.
 */
export async function forceConfigDraft(table) {
  if (table !== 'raffle_config' && table !== 'vote_config') {
    throw new Error(`unexpected table: ${table}`);
  }
  await ensureOwnerConnected();
  await ownerClient.query(`UPDATE ${table} SET status = 'draft', opens_at = NULL, closes_at = NULL WHERE id = 1`);
}

/** Generates N synthetic employees with predictable IDs and known last-4 NIC digits. */
export function makeTestEmployees(count, prefix = 'T') {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      empId: `${prefix}${String(n).padStart(3, '0')}`,
      name: `Test Employee ${n}`,
      dept: 'QA',
      last4: String(1000 + n).slice(-4),
    };
  });
}

export async function seedEmployees(rows) {
  const { errors } = await importEmployees(rows);
  if (errors.length > 0) {
    throw new Error(`seedEmployees failed: ${JSON.stringify(errors)}`);
  }
}

/** Upserts an admin_users row directly (mirrors db/seed/create-admin.js). */
export async function createAdmin(username, password, role) {
  await ensureOwnerConnected();
  const passwordHash = await argon2.hash(password);
  await ownerClient.query(
    `INSERT INTO admin_users (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = $2, role = $3`,
    [username, passwordHash, role]
  );
}

export function normalGifts(count = 10) {
  return Array.from({ length: count }, (_, i) => ({ name: `Normal Gift ${i + 1}`, tier: 'normal' }));
}
export function premiumGifts(count = 15) {
  return Array.from({ length: count }, (_, i) => ({ name: `Premium Gift ${i + 1}`, tier: 'premium' }));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Call once per test file, in an `after()` hook, so the process can exit. */
export async function closeAllConnections() {
  if (ownerConnected) {
    await ownerClient.end();
    ownerConnected = false;
  }
  await appPool.end();
}
