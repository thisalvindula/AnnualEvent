import argon2 from 'argon2';
import { query } from '../db.js';
import { config } from '../config.js';
import { extractLast4FromFullNic, isValidLast4Input, normalizeLast4Input } from '../nic.js';
import { logEvent } from '../audit/index.js';
import { isLocked, recordFailedAttempt, clearAttempts } from '../ratelimit.js';

function hashLast4(last4) {
  // Pepper (app-wide secret, from env) + argon2's own per-hash random salt.
  return argon2.hash(config.nicPepper + last4);
}

async function verifyLast4(hash, last4) {
  // argon2.verify performs a safe (non-short-circuiting) comparison of the digest.
  try {
    return await argon2.verify(hash, config.nicPepper + last4);
  } catch {
    // hash isn't a well-formed argon2 digest — e.g. an employee redacted
    // post-event (see docs/RUNBOOK.md step 19). Treat as "does not match"
    // rather than letting the request crash.
    return false;
  }
}

/**
 * Parses a simple CSV (header: emp_id,name,dept,nic) into employee rows,
 * validating the NIC on every row via core/nic.js — the same function used
 * at verification time, so import and verify can never disagree.
 *
 * Bad rows are collected and returned, never silently skipped.
 */
export function parseEmployeeCsv(csvText) {
  const rows = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (rows.length === 0) return { valid: [], errors: [] };

  const header = rows[0].split(',').map((h) => h.trim().toLowerCase());
  const empIdIdx = header.indexOf('emp_id');
  const nameIdx = header.indexOf('name');
  const deptIdx = header.indexOf('dept');
  const nicIdx = header.indexOf('nic');

  if (empIdIdx === -1 || nameIdx === -1 || nicIdx === -1) {
    return {
      valid: [],
      errors: [{ row: 1, reason: 'Header must include emp_id, name, and nic columns' }],
    };
  }

  const valid = [];
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1;
    const cols = rows[i].split(',').map((c) => c.trim());
    const empId = cols[empIdIdx];
    const name = cols[nameIdx];
    const dept = deptIdx !== -1 ? cols[deptIdx] : null;
    const nic = cols[nicIdx];

    if (!empId) {
      errors.push({ row: rowNum, reason: 'Missing emp_id' });
      continue;
    }
    if (!name) {
      errors.push({ row: rowNum, empId, reason: 'Missing name' });
      continue;
    }
    const last4 = extractLast4FromFullNic(nic);
    if (!last4) {
      errors.push({ row: rowNum, empId, reason: `Invalid NIC format: "${nic}"` });
      continue;
    }

    valid.push({ empId, name, dept: dept || null, last4 });
  }

  return { valid, errors };
}

/**
 * Imports (upserts) a batch of already-parsed employee rows. Returns counts
 * plus any per-row errors, so the caller can report exactly what happened.
 */
export async function importEmployees(rows) {
  let imported = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const nicHash = await hashLast4(row.last4);
      await query(
        `INSERT INTO employees (emp_id, name, dept, nic_last4_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (emp_id) DO UPDATE SET name = $2, dept = $3, nic_last4_hash = $4`,
        [row.empId, row.name, row.dept, nicHash]
      );
      imported++;
    } catch (err) {
      errors.push({ empId: row.empId, reason: err.message });
    }
  }

  return { imported, errors };
}

/** Read-only roster for the admin UI. Deliberately omits nic_last4_hash. */
export async function listEmployees() {
  const { rows } = await query(
    `SELECT emp_id AS "empId", name, dept FROM employees ORDER BY emp_id ASC`
  );
  return rows;
}

export async function findEmployeeById(empId) {
  const { rows } = await query(
    `SELECT emp_id, name, dept, nic_last4_hash FROM employees WHERE emp_id = $1`,
    [empId]
  );
  return rows[0] ?? null;
}

/**
 * Shared verification rule for both modules (requirement 9.2): employee number
 * + last-4 NIC digits together, one step, same-shaped failure for "unknown
 * employee" and "wrong NIC" so colleagues' IDs can't be enumerated. Every
 * failed attempt is logged; 3 wrong NICs lock that employee ID for a few
 * minutes.
 */
export async function verifyEmployeeCredentials({ empId, last4, ip, module }) {
  const genericFailure = { ok: false, reason: 'invalid', message: 'Please contact HR' };

  if (typeof empId !== 'string' || empId.trim().length === 0) {
    return genericFailure;
  }
  const normalizedLast4 = normalizeLast4Input(last4);
  if (!isValidLast4Input(normalizedLast4)) {
    return genericFailure;
  }

  if (isLocked(empId)) {
    await logEvent({ module, event: 'verify_locked', empId, ip });
    return { ok: false, reason: 'locked', message: 'Too many attempts. Please try again in a few minutes.' };
  }

  const employee = await findEmployeeById(empId);
  if (!employee) {
    await logEvent({ module, event: 'verify_unknown_employee', empId, ip });
    return genericFailure;
  }

  const match = await verifyLast4(employee.nic_last4_hash, normalizedLast4);
  if (!match) {
    const attempt = recordFailedAttempt(empId);
    await logEvent({ module, event: 'verify_nic_mismatch', empId, ip, detail: { attempt: attempt.count } });
    return genericFailure;
  }

  clearAttempts(empId);
  await logEvent({ module, event: 'verify_success', empId, ip });
  return { ok: true, empId: employee.emp_id, name: employee.name };
}
