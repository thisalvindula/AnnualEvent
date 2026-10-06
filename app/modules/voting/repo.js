import { pool, query } from '../../core/db.js';

export async function getConfig() {
  const { rows } = await query(
    `SELECT id, opens_at, closes_at, duration_minutes, CASE WHEN status = 'open' AND closes_at <= now() THEN 'closed' ELSE status END AS status FROM vote_config WHERE id = 1`
  );
  return rows[0];
}

export async function setDurationMinutes(minutes) {
  const { rows } = await query(
    `UPDATE vote_config SET duration_minutes = $1 WHERE id = 1 AND status = 'draft'
     RETURNING id, opens_at, closes_at, duration_minutes, status`,
    [minutes]
  );
  return rows[0] ?? null;
}

export async function setStatusOpen(durationMinutes) {
  const { rows } = await query(
    `UPDATE vote_config
     SET status = 'open', opens_at = now(), closes_at = now() + make_interval(mins => $1::int), duration_minutes = $1::int
     WHERE id = 1 AND (status IN ('draft', 'closed') OR (status = 'open' AND closes_at <= now()))
     RETURNING id, opens_at, closes_at, duration_minutes, status`,
    [durationMinutes]
  );
  return rows[0] ?? null;
}

export async function setStatusClosed() {
  const { rows } = await query(
    `UPDATE vote_config
     SET status = 'closed', closes_at = LEAST(closes_at, now())
     WHERE id = 1 AND status = 'open'
     RETURNING id, opens_at, closes_at, duration_minutes, status`
  );
  return rows[0] ?? null;
}

/**
 * Wipes cast votes (and, optionally, the finalist list) and puts voting
 * back in 'draft' so it can be started again from scratch. Gated in the
 * service layer behind re-entering the operator's own password.
 */
export async function resetVoting({ wipeFinalists }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM vote_votes');
    if (wipeFinalists) {
      await client.query('DELETE FROM vote_finalists');
    }
    await client.query(
      `UPDATE vote_config SET status = 'draft', opens_at = NULL, closes_at = NULL WHERE id = 1`
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getFinalists() {
  const { rows } = await query(
    `SELECT f.id, f.name, f.song, f.position, f.emp_id AS "empId", e.image_name AS "imageName"
     FROM vote_finalists f
     LEFT JOIN employees e ON e.emp_id = f.emp_id
     ORDER BY f.position ASC`
  );
  return rows;
}

/** Returns the updated finalist row, or null if no finalist has that id. */
export async function updateFinalist(id, { name, song, empId }) {
  const { rows } = await query(
    `UPDATE vote_finalists SET name = $2, song = $3, emp_id = $4 WHERE id = $1
     RETURNING id, name, song, position, emp_id AS "empId"`,
    [id, name, song, empId]
  );
  return rows[0] ?? null;
}

export async function replaceFinalists(finalists) {
  // finalists: [{ name, song, position, empId }]
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM vote_finalists');
    for (const f of finalists) {
      await client.query('INSERT INTO vote_finalists (name, song, position, emp_id) VALUES ($1, $2, $3, $4)', [
        f.name,
        f.song ?? null,
        f.position,
        f.empId ?? null,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function hasVoted(empId) {
  const { rows } = await query('SELECT 1 FROM vote_votes WHERE emp_id = $1', [empId]);
  return rows.length > 0;
}

/**
 * Atomic insert: ON CONFLICT DO NOTHING means exactly one concurrent caller
 * for the same emp_id ever gets a row back (the first vote is final).
 */
export async function insertVote({ empId, finalistId, ip, userAgent }) {
  const { rows } = await query(
    `INSERT INTO vote_votes (emp_id, finalist_id, ip, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (emp_id) DO NOTHING
     RETURNING emp_id, finalist_id, voted_at`,
    [empId, finalistId, ip, userAgent]
  );
  return rows[0] ?? null;
}

export async function getTally() {
  const { rows } = await query(
    `SELECT f.id, f.name, f.song, f.position, f.emp_id AS "empId", e.image_name AS "imageName",
            count(v.emp_id)::int AS votes
     FROM vote_finalists f
     LEFT JOIN employees e ON e.emp_id = f.emp_id
     LEFT JOIN vote_votes v ON v.finalist_id = f.id
     GROUP BY f.id, f.name, f.song, f.position, f.emp_id, e.image_name
     ORDER BY f.position ASC`
  );
  return rows;
}

export async function getTotalVotes() {
  const { rows } = await query('SELECT count(*)::int AS count FROM vote_votes');
  return rows[0].count;
}

function toCsv(rows, header) {
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      header
        .map((col) => {
          const v = row[col];
          if (v === null || v === undefined) return '';
          const str = v instanceof Date ? v.toISOString() : String(v);
          return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
        })
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Votes CSV with employee IDs — the traceable export (requirement 8: "Vote
 * stores the employee ID with the choice, for full audit"). Auditor role only.
 */
export async function exportVotesCsv() {
  const { rows } = await query(
    `SELECT v.emp_id, e.name AS voter_name, f.name AS finalist, f.position, v.voted_at, v.ip, v.user_agent
     FROM vote_votes v
     JOIN employees e ON e.emp_id = v.emp_id
     JOIN vote_finalists f ON f.id = v.finalist_id
     ORDER BY v.voted_at ASC`
  );
  return toCsv(rows, ['emp_id', 'voter_name', 'finalist', 'position', 'voted_at', 'ip', 'user_agent']);
}

export function tallyToCsv(tally) {
  return toCsv(tally, ['position', 'name', 'song', 'votes']);
}
