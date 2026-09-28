import { query } from '../db.js';

export async function findAdminByUsername(username) {
  const { rows } = await query(
    `SELECT id, username, password_hash, role FROM admin_users WHERE username = $1`,
    [username]
  );
  return rows[0] ?? null;
}
