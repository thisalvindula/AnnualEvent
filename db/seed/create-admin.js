// Creates or resets an admin operator account. There is no HTTP route for
// this deliberately (admin_users is provisioned out of band, see the grant
// comments in db/migrations/001_core.sql) so this runs with the schema-owner
// connection string, never the restricted runtime role.
//
// Usage: node db/seed/create-admin.js <username> <password> <raffle_operator|vote_operator|auditor>

import pg from 'pg';
import argon2 from 'argon2';
import 'dotenv/config';

const [, , username, password, role] = process.argv;
const VALID_ROLES = ['raffle_operator', 'vote_operator', 'auditor'];

if (!username || !password || !role) {
  console.error('Usage: node db/seed/create-admin.js <username> <password> <raffle_operator|vote_operator|auditor>');
  process.exit(1);
}
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}
if (password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  console.error('MIGRATION_DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

const passwordHash = await argon2.hash(password);

await client.query(
  `INSERT INTO admin_users (username, password_hash, role)
   VALUES ($1, $2, $3)
   ON CONFLICT (username) DO UPDATE SET password_hash = $2, role = $3`,
  [username, passwordHash, role]
);

console.log(`Admin user "${username}" (${role}) created/updated.`);
await client.end();
