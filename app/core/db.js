import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  min: config.dbPoolMin,
  max: config.dbPoolMax,
});

// node-postgres gotcha: an *idle* pooled client dropped by Postgres (restart,
// network blip) emits 'error' on the Pool itself. With no listener that's an
// unhandled event and crashes the whole process. The pool already discards
// the bad client internally, so all we need to do here is not crash.
pool.on('error', (err) => {
  console.error('[db] idle pool client error (recovered):', err);
});

export function query(text, params) {
  return pool.query(text, params);
}
