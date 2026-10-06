import { pool, query } from '../db.js';

export async function getModuleStatuses() {
  const { rows: raffleRows } = await query(`SELECT CASE WHEN status = 'open' AND closes_at <= now() THEN 'closed' ELSE status END AS status FROM raffle_config WHERE id = 1`);
  const { rows: voteRows } = await query(`SELECT CASE WHEN status = 'open' AND closes_at <= now() THEN 'closed' ELSE status END AS status FROM vote_config WHERE id = 1`);
  return { raffleStatus: raffleRows[0]?.status ?? null, voteStatus: voteRows[0]?.status ?? null };
}

/**
 * Wipes every table the event's operators would otherwise re-enter for a
 * fresh run: employees, raffle entries/gifts/draws, voting finalists/votes.
 * admin_users and audit_log are never touched. Gated in the service layer
 * behind re-entering the admin's own password. Deletes respect FK order
 * (children before the employees/gifts/finalists they reference).
 */
export async function clearAllData() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM raffle_draw_results');
    await client.query('DELETE FROM raffle_registrations');
    await client.query('DELETE FROM vote_votes');
    await client.query('DELETE FROM vote_finalists');
    await client.query('DELETE FROM raffle_gifts');
    await client.query('DELETE FROM employees');
    await client.query(
      `UPDATE raffle_config SET status = 'draft', opens_at = NULL, closes_at = NULL WHERE id = 1`
    );
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
