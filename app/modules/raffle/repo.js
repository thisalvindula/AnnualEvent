import { pool, query } from '../../core/db.js';

export async function getConfig() {
  const { rows } = await query('SELECT id, opens_at, closes_at, status FROM raffle_config WHERE id = 1');
  return rows[0];
}

export async function setStatusOpen(closesAtSeconds) {
  const { rows } = await query(
    `UPDATE raffle_config
     SET status = 'open', opens_at = now(), closes_at = now() + make_interval(secs => $1::int)
     WHERE id = 1 AND status IN ('draft', 'closed')
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

export async function getGifts() {
  const { rows } = await query('SELECT id, name, tier, seq FROM raffle_gifts ORDER BY seq ASC');
  return rows;
}

export async function replaceGifts(gifts) {
  // gifts: [{ name, tier, seq }], already ordered normal-first/premium-last by the caller.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM raffle_gifts');
    for (const gift of gifts) {
      await client.query('INSERT INTO raffle_gifts (name, tier, seq) VALUES ($1, $2, $3)', [
        gift.name,
        gift.tier,
        gift.seq,
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
    `SELECT r.ticket_no, r.emp_id, e.name, e.dept, r.registered_at, r.ip, r.user_agent
     FROM raffle_registrations r
     JOIN employees e ON e.emp_id = r.emp_id
     ORDER BY r.ticket_no ASC`
  );
  const header = ['ticket_no', 'emp_id', 'name', 'dept', 'registered_at', 'ip', 'user_agent'];
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
 * Next undrawn gift, in seq order (normal gifts first, premium last).
 */
export async function getNextUndrawnGift() {
  const { rows } = await query(
    `SELECT id, name, tier, seq FROM raffle_gifts
     WHERE seq NOT IN (SELECT seq FROM raffle_draw_results)
     ORDER BY seq ASC LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function getEligibleEmpIds() {
  const { rows } = await query(
    `SELECT r.emp_id FROM raffle_registrations r
     WHERE r.emp_id NOT IN (SELECT emp_id FROM raffle_draw_results)`
  );
  return rows.map((r) => r.emp_id);
}

/**
 * Atomic insert: ON CONFLICT DO NOTHING on the seq PK is the backstop against
 * a double "draw next" race drawing the same gift twice; the emp_id UNIQUE
 * constraint is the backstop against the same person winning twice.
 */
export async function insertDrawResult({ seq, empId }) {
  const { rows } = await query(
    `INSERT INTO raffle_draw_results (seq, emp_id)
     VALUES ($1, $2)
     ON CONFLICT (seq) DO NOTHING
     RETURNING seq, emp_id, drawn_at`,
    [seq, empId]
  );
  return rows[0] ?? null;
}

export async function getDrawResultsCount() {
  const { rows } = await query('SELECT count(*)::int AS count FROM raffle_draw_results');
  return rows[0].count;
}

export async function exportResultsCsv() {
  const { rows } = await query(
    `SELECT g.seq, g.name AS gift_name, g.tier, d.emp_id, e.name AS winner_name, d.drawn_at
     FROM raffle_draw_results d
     JOIN raffle_gifts g ON g.seq = d.seq
     JOIN employees e ON e.emp_id = d.emp_id
     ORDER BY g.seq ASC`
  );
  const header = ['seq', 'gift_name', 'tier', 'emp_id', 'winner_name', 'drawn_at'];
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
