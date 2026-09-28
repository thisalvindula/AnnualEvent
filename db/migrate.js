import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;
const migrationsDir = path.dirname(fileURLToPath(import.meta.url)) + '/migrations';

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  console.error('MIGRATION_DATABASE_URL is not set');
  process.exit(1);
}

function renderTemplate(sql) {
  return sql.replaceAll('__APP_DB_PASSWORD__', (process.env.APP_DB_PASSWORD ?? '').replaceAll("'", "''"));
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
  );

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ranCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const raw = await readFile(path.join(migrationsDir, file), 'utf8');
    const sql = renderTemplate(raw);

    console.log(`Applying migration: ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ranCount++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Migration failed: ${file}`);
      console.error(err);
      await client.end();
      process.exit(1);
    }
  }

  console.log(ranCount === 0 ? 'No pending migrations.' : `Applied ${ranCount} migration(s).`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
