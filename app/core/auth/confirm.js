import { findAdminByUsername } from './repo.js';
import { verifyPassword } from './passwords.js';

/**
 * Re-checks the currently logged-in admin's own password, for confirming
 * destructive actions (e.g. wiping entries/votes before a fresh reopen)
 * beyond just holding a valid session cookie.
 */
export async function verifyOwnPassword(username, password) {
  if (typeof password !== 'string' || password.length === 0) return false;
  const admin = await findAdminByUsername(username);
  if (!admin) return false;
  return verifyPassword(admin.password_hash, password);
}
