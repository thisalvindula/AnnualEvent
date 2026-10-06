import argon2 from 'argon2';
import { query } from '../db.js';
import { config } from '../config.js';
import { extractLast4FromFullNic, extractLast4FromUserInput, normalizeFullNic } from '../nic.js';
import { encryptNic, decryptNic } from '../nic-crypto.js';
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

const IMAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,199}$/;

/**
 * Photo file names are plain file names inside /employee-photos/ (e.g.
 * "E001.jpg"). Path separators are rejected so a name can never point outside
 * that folder. Returns an error message, or null when valid.
 */
export function validateImageName(imageName) {
  if (!IMAGE_NAME_PATTERN.test(imageName) || imageName.includes('..')) {
    return `Invalid image name "${imageName}" (use a plain file name such as E001.jpg)`;
  }
  return null;
}

/**
 * Parses a simple CSV (header: emp_id,name,nic[,image_name]) into employee
 * rows, validating the NIC on every row via core/nic.js — the same function
 * used at verification time, so import and verify can never disagree. Extra
 * columns (e.g. a legacy "dept") are ignored.
 *
 * Bad rows are collected and returned, never silently skipped.
 */
export function parseEmployeeCsv(csvText) {
  const rows = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (rows.length === 0) return { valid: [], errors: [] };

  const header = rows[0].split(',').map((h) => h.trim().toLowerCase());
  const empIdIdx = header.indexOf('emp_id');
  const nameIdx = header.indexOf('name');
  const nicIdx = header.indexOf('nic');
  const imageIdx = header.indexOf('image_name');

  if (empIdIdx === -1 || nameIdx === -1 || nicIdx === -1) {
    return {
      valid: [],
      errors: [{ row: 1, reason: 'Header must include emp_id, name, and nic columns (image_name is optional)' }],
    };
  }

  const valid = [];
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1;
    const cols = rows[i].split(',').map((c) => c.trim());
    const empId = cols[empIdIdx];
    const name = cols[nameIdx];
    const nic = cols[nicIdx];
    const imageName = imageIdx !== -1 ? cols[imageIdx] || null : null;

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
    const imageError = imageName ? validateImageName(imageName) : null;
    if (imageError) {
      errors.push({ row: rowNum, empId, reason: imageError });
      continue;
    }

    valid.push({ empId, name, imageName, last4, nic: normalizeFullNic(nic) });
  }

  return { valid, errors };
}

/**
 * Imports (upserts) a batch of already-parsed employee rows. Returns counts
 * plus any per-row errors, so the caller can report exactly what happened.
 * A row without an imageName keeps whatever image the employee already has.
 */
export async function importEmployees(rows) {
  let imported = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const nicHash = await hashLast4(row.last4);
      // A row that only carries last4 (no full NIC) clears the stored NIC rather
      // than leaving one that no longer matches the new hash.
      const nicEncrypted = row.nic ? encryptNic(row.nic) : null;
      await query(
        `INSERT INTO employees (emp_id, name, image_name, nic_last4_hash, nic_encrypted)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (emp_id) DO UPDATE
           SET name = $2, image_name = COALESCE($3, employees.image_name), nic_last4_hash = $4, nic_encrypted = $5`,
        [row.empId, row.name, row.imageName ?? null, nicHash, nicEncrypted]
      );
      imported++;
    } catch (err) {
      errors.push({ empId: row.empId, reason: err.message });
    }
  }

  return { imported, errors };
}

/**
 * Roster for the admin UI. Deliberately omits nic_last4_hash; `nic` is the
 * decrypted full NIC, or null when none is stored (employee added before NICs
 * were kept, or the value was redacted post-event).
 */
export async function listEmployees() {
  const { rows } = await query(
    `SELECT emp_id AS "empId", name, image_name AS "imageName", nic_encrypted FROM employees ORDER BY emp_id ASC`
  );
  return rows.map(({ nic_encrypted: encrypted, ...employee }) => ({ ...employee, nic: decryptNic(encrypted) }));
}

export async function findEmployeeById(empId) {
  const { rows } = await query(
    `SELECT emp_id, name, image_name, nic_last4_hash, nic_encrypted FROM employees WHERE emp_id = $1`,
    [empId]
  );
  return rows[0] ?? null;
}

/** Admin: add a single employee. `nic` is the full NIC; only the last 4 digits are kept (hashed). */
export async function createEmployee({ empId, name, nic, imageName, ip, by }) {
  empId = String(empId ?? '').trim();
  name = String(name ?? '').trim();
  imageName = String(imageName ?? '').trim() || null;
  if (!empId) return { ok: false, message: 'Employee ID is required' };
  if (!name) return { ok: false, message: 'Name is required' };
  const fullNic = normalizeFullNic(String(nic ?? ''));
  if (!fullNic) return { ok: false, message: 'Invalid NIC format' };
  const imageError = imageName ? validateImageName(imageName) : null;
  if (imageError) return { ok: false, message: imageError };

  const { rowCount } = await query(
    `INSERT INTO employees (emp_id, name, image_name, nic_last4_hash, nic_encrypted)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (emp_id) DO NOTHING`,
    [empId, name, imageName, await hashLast4(extractLast4FromFullNic(fullNic)), encryptNic(fullNic)]
  );
  if (rowCount === 0) {
    return { ok: false, reason: 'exists', message: `Employee ${empId} already exists` };
  }
  await logEvent({ module: 'core', event: 'employee_created', empId, ip, detail: { by } });
  return { ok: true, employee: { empId, name, imageName } };
}

/**
 * Admin: edit an employee. The employee ID is the record's key and can't be
 * changed (delete + re-add instead). `nic` is optional — omit/blank to keep the
 * current one. `imageName: null` or '' clears the photo; `undefined` keeps it.
 */
export async function updateEmployee(empId, { name, nic, imageName, ip, by }) {
  const existing = await findEmployeeById(empId);
  if (!existing) return { ok: false, reason: 'not_found', message: `Employee ${empId} not found` };

  const nextName = name === undefined ? existing.name : String(name).trim();
  if (!nextName) return { ok: false, message: 'Name is required' };

  let nextImage = existing.image_name;
  if (imageName !== undefined) {
    nextImage = imageName === null ? null : String(imageName).trim() || null;
    const imageError = nextImage ? validateImageName(nextImage) : null;
    if (imageError) return { ok: false, message: imageError };
  }

  let nextHash = existing.nic_last4_hash;
  let nextEncrypted = existing.nic_encrypted;
  // The admin form is pre-filled with the current NIC, so "changed" means the
  // submitted NIC differs from what's stored (not merely that one was sent).
  const submittedNic = typeof nic === 'string' ? nic.trim() : '';
  const fullNic = submittedNic === '' ? null : normalizeFullNic(submittedNic);
  if (submittedNic !== '' && !fullNic) return { ok: false, message: 'Invalid NIC format' };
  const nicChanged = fullNic !== null && fullNic !== decryptNic(existing.nic_encrypted);
  if (nicChanged) {
    nextHash = await hashLast4(extractLast4FromFullNic(fullNic));
    nextEncrypted = encryptNic(fullNic);
  }

  await query(
    `UPDATE employees SET name = $2, image_name = $3, nic_last4_hash = $4, nic_encrypted = $5 WHERE emp_id = $1`,
    [empId, nextName, nextImage, nextHash, nextEncrypted]
  );
  if (nicChanged) {
    // The employee was probably locked out by repeated wrong-NIC attempts
    // before an admin fixed the record; let them try again straight away.
    clearAttempts(empId);
  }
  await logEvent({ module: 'core', event: 'employee_updated', empId, ip, detail: { by, nicChanged } });
  return { ok: true, employee: { empId, name: nextName, imageName: nextImage, nic: decryptNic(nextEncrypted) } };
}

/**
 * Admin: remove an employee. Refused when the employee already has a raffle
 * entry, a vote, or a finalist link (foreign keys) — deleting would erase
 * audit history. Use the password-gated resets for that.
 */
export async function deleteEmployee(empId, { ip, by } = {}) {
  try {
    const { rowCount } = await query('DELETE FROM employees WHERE emp_id = $1', [empId]);
    if (rowCount === 0) return { ok: false, reason: 'not_found', message: `Employee ${empId} not found` };
  } catch (err) {
    if (err.code === '23503') {
      return {
        ok: false,
        reason: 'in_use',
        message: `Employee ${empId} already has a raffle entry, vote or finalist link and can't be deleted`,
      };
    }
    throw err;
  }
  await logEvent({ module: 'core', event: 'employee_deleted', empId, ip, detail: { by } });
  return { ok: true };
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
  const normalizedLast4 = extractLast4FromUserInput(last4);
  if (!normalizedLast4) {
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
