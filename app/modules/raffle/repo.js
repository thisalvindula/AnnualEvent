import { pool, query } from '../../core/db.js';

export async function getConfig() {
  const { rows } = await query(`SELECT id, opens_at, closes_at, CASE WHEN status = 'open' AND closes_at <= now() THEN 'closed' ELSE status END AS status FROM raffle_config WHERE id = 1`);
  return rows[0];
}

export async function setStatusOpen(closesAtSeconds) {
  const { rows } = await query(
    `UPDATE raffle_config
     SET status = 'open', opens_at = now(), closes_at = now() + make_interval(secs => $1::int)
     WHERE id = 1 AND (status IN ('draft', 'closed') OR (status = 'open' AND closes_at <= now()))
     RETURNING id, opens_at, closes_at, status`,
    [closesAtSeconds]
  );
  return rows[0] ?? null;
}

export async function setStatusClosed() {
  const { rows } = await query(
    `UPDATE raffle_config
     SET status = 'closed', closes_at = LEAST(closes_at, now())
     WHERE id = 1 AND status = 'open'
     RETURNING id, opens_at, closes_at, status`
  );
  return rows[0] ?? null;
}

const GIFT_SELECT = `
  SELECT g.id, g.place, g.quantity, g.description, g.section, count(d.emp_id)::int AS drawn
  FROM raffle_gifts g
  LEFT JOIN raffle_draw_results d ON d.gift_id = g.id`;

/** Gifts in draw order (ascending id), each with how many of its winners are already drawn. */
export async function getGifts() {
  const { rows } = await query(`${GIFT_SELECT} GROUP BY g.id ORDER BY g.id ASC`);
  return rows;
}

export async function getGift(id) {
  const { rows } = await query(`${GIFT_SELECT} WHERE g.id = $1 GROUP BY g.id`, [id]);
  return rows[0] ?? null;
}

/** Returns the inserted gift, or null if a gift with that id already exists. */
export async function insertGift({ id, place, quantity, description, section }) {
  const { rows } = await query(
    `INSERT INTO raffle_gifts (id, place, quantity, description, section)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [id, place, quantity, description, section]
  );
  return rows[0] ? getGift(rows[0].id) : null;
}

/**
 * Updates a gift in place (newId may differ from id; draw results follow via
 * ON UPDATE CASCADE). Returns the updated gift, null if `id` doesn't exist.
 * Throws a Postgres 23505 if newId is already taken.
 */
export async function updateGift(id, { newId, place, quantity, description, section }) {
  const { rows } = await query(
    `UPDATE raffle_gifts SET id = $2, place = $3, quantity = $4, description = $5, section = $6
     WHERE id = $1 RETURNING id`,
    [id, newId, place, quantity, description, section]
  );
  return rows[0] ? getGift(rows[0].id) : null;
}

/** Throws a Postgres 23503 if the gift already has winners. */
export async function deleteGift(id) {
  const { rowCount } = await query('DELETE FROM raffle_gifts WHERE id = $1', [id]);
  return rowCount > 0;
}

/** Total winners to draw (sum of quantities) and how many are drawn so far. */
export async function getPrizeProgress() {
  const { rows } = await query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS "totalPrizes",
            (SELECT count(*)::int FROM raffle_draw_results) AS "drawnCount"
     FROM raffle_gifts`
  );
  return rows[0];
}

/**
 * Wipes registrations + draw results (and, optionally, the gift list) and
 * puts the raffle back in 'draft' so it can be opened again from scratch.
 * Gated in the service layer behind re-entering the operator's own password.
 */
export async function resetRaffle({ wipeGifts }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM raffle_draw_results');
    await client.query('DELETE FROM raffle_registrations');
    if (wipeGifts) {
      await client.query('DELETE FROM raffle_gifts');
    }
    await client.query(
      `UPDATE raffle_config SET status = 'draft', opens_at = NULL, closes_at = NULL WHERE id = 1`
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getRegistrationCount() {
  const { rows } = await query('SELECT count(*)::int AS count FROM raffle_registrations');
  return rows[0].count;
}

/**
 * Atomic insert: ON CONFLICT DO NOTHING means exactly one concurrent caller
 * for the same emp_id ever gets a row back (requirement 8/12 concurrency test).
 */
export async function insertRegistration({ empId, ip, userAgent }) {
  const { rows } = await query(
    `INSERT INTO raffle_registrations (emp_id, ip, user_agent)
     VALUES ($1, $2, $3)
     ON CONFLICT (emp_id) DO NOTHING
     RETURNING emp_id, ticket_no, registered_at`,
    [empId, ip, userAgent]
  );
  return rows[0] ?? null;
}

export async function isRegistered(empId) {
  const { rows } = await query('SELECT 1 FROM raffle_registrations WHERE emp_id = $1', [empId]);
  return rows.length > 0;
}

export async function exportRegistrationsCsv() {
  const { rows } = await query(
    `SELECT r.ticket_no, r.emp_id, e.name, r.registered_at, r.ip, r.user_agent
     FROM raffle_registrations r
     JOIN employees e ON e.emp_id = r.emp_id
     ORDER BY r.ticket_no ASC`
  );
  const header = ['ticket_no', 'emp_id', 'name', 'registered_at', 'ip', 'user_agent'];
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
  return { csv: lines.join('\n') + '\n', count: rows.length };
}

/**
 * Next gift that still has winners left to draw, in ascending id order.
 */
export async function getNextUndrawnGift() {
  const { rows } = await query(
    `${GIFT_SELECT}
     GROUP BY g.id
     HAVING count(d.emp_id) < g.quantity
     ORDER BY g.id ASC LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function getEntrantNames() {
  const { rows } = await query(
    `SELECT e.name FROM raffle_registrations r JOIN employees e ON e.emp_id = r.emp_id`
  );
  return rows.map((r) => r.name);
}

export async function getEligibleEmpIds() {
  const { rows } = await query(
    `SELECT r.emp_id FROM raffle_registrations r
     WHERE r.emp_id NOT IN (SELECT emp_id FROM raffle_draw_results)`
  );
  return rows.map((r) => r.emp_id);
}

/**
 * Atomic insert: a bare ON CONFLICT DO NOTHING covers both backstops — the
 * (gift_id, slot) PK stops a double "draw next" race filling one slot twice,
 * and the emp_id UNIQUE stops the same person winning twice. Either way a
 * lost race returns null and the caller retries with fresh state.
 */
export async function insertDrawResult({ giftId, slot, empId }) {
  const { rows } = await query(
    `INSERT INTO raffle_draw_results (gift_id, slot, emp_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING gift_id, slot, emp_id, drawn_at`,
    [giftId, slot, empId]
  );
  return rows[0] ?? null;
}

export async function getDrawResultsCount() {
  const { rows } = await query('SELECT count(*)::int AS count FROM raffle_draw_results');
  return rows[0].count;
}

/**
 * Most recent draws, newest first, joined for display — same shape of JOIN as
 * exportResultsCsv but ordered by recency and capped, for seeding the big
 * screen / admin page's "who just won" state on connect/reload.
 */
export async function getRecentDrawResults(limit = 6) {
  const { rows } = await query(
    `SELECT g.id AS gift_id, g.place, g.description, g.quantity, d.slot, d.emp_id, e.name, e.image_name, d.drawn_at
     FROM raffle_draw_results d
     JOIN raffle_gifts g ON g.id = d.gift_id
     JOIN employees e ON e.emp_id = d.emp_id
     ORDER BY d.drawn_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Every winner drawn so far, in draw order — fills the draw layout's slots after a reload. */
export async function getAllDrawResults() {
  const { rows } = await query(
    `SELECT d.gift_id, d.slot, d.emp_id, e.name, e.image_name
     FROM raffle_draw_results d
     JOIN employees e ON e.emp_id = d.emp_id
     ORDER BY d.gift_id ASC, d.slot ASC`
  );
  return rows;
}

/**
 * The most recent "registrations_exported" (seal) audit event, read back out
 * of audit_log rather than a dedicated column — logEvent() already durably
 * records {count, sha256} there every time the list is sealed. Scoped to
 * raffle_config.opens_at so a seal from a round that's since been reset
 * doesn't linger forever and get mistaken for the current round's seal
 * (audit_log itself is never pruned, by design).
 */
export async function getLastSeal() {
  const { rows } = await query(
    `SELECT ts, detail FROM audit_log
     WHERE module = 'raffle' AND event = 'registrations_exported'
       AND ts >= COALESCE((SELECT opens_at FROM raffle_config WHERE id = 1), '-infinity'::timestamptz)
     ORDER BY ts DESC LIMIT 1`
  );
  if (rows.length === 0) return null;
  const { count, sha256 } = rows[0].detail;
  return { count, sha256, exportedAt: rows[0].ts };
}

export async function exportResultsCsv() {
  const { rows } = await query(
    `SELECT g.id AS gift_id, g.place, g.description, d.slot, d.emp_id, e.name AS winner_name, d.drawn_at
     FROM raffle_draw_results d
     JOIN raffle_gifts g ON g.id = d.gift_id
     JOIN employees e ON e.emp_id = d.emp_id
     ORDER BY g.id ASC, d.slot ASC`
  );
  const header = ['gift_id', 'place', 'description', 'slot', 'emp_id', 'winner_name', 'drawn_at'];
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
