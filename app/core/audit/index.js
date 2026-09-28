import { query } from '../db.js';

/**
 * Appends one row to audit_log. The app's DB role only has INSERT/SELECT on
 * this table (see db/migrations/001_core.sql) so this is the only way rows
 * can be written, and nothing in the app can update or delete them.
 */
export async function logEvent({ module = 'core', event, empId = null, ip = null, detail = null }) {
  await query(
    `INSERT INTO audit_log (module, event, emp_id, ip, detail) VALUES ($1, $2, $3, $4, $5)`,
    [module, event, empId, ip, detail ? JSON.stringify(detail) : null]
  );
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export async function exportAuditCsv() {
  const { rows } = await query(
    `SELECT id, ts, module, event, emp_id, ip, detail FROM audit_log ORDER BY id ASC`
  );

  const header = ['id', 'ts', 'module', 'event', 'emp_id', 'ip', 'detail'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((col) => csvEscape(row[col])).join(','));
  }
  return lines.join('\n') + '\n';
}
