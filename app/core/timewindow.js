import { query } from './db.js';

// All open/close decisions use PostgreSQL's now(), never the client or app-server
// clock (requirement 9.1). Both modules call this with their own config row.

export async function getServerNow() {
  const { rows } = await query('SELECT now() AS now');
  return rows[0].now;
}

/**
 * Pure function: given a config row ({status, opens_at, closes_at}) and the
 * current server time, returns whether the window is open right now and how
 * many seconds remain. Kept pure/exported so it's directly unit-testable.
 */
export function computeWindowState({ status, opensAt, closesAt }, now) {
  const nowMs = now.getTime();

  if (status !== 'open' || !opensAt || !closesAt) {
    return { isOpen: false, status, secondsRemaining: 0 };
  }

  const opensMs = new Date(opensAt).getTime();
  const closesMs = new Date(closesAt).getTime();

  if (nowMs < opensMs) {
    return { isOpen: false, status, secondsRemaining: 0 };
  }
  if (nowMs >= closesMs) {
    // Window has elapsed even if no admin action has flipped the DB status
    // to 'closed' yet; the server is the only authority (requirement 9.1).
    return { isOpen: false, status: 'closed', secondsRemaining: 0 };
  }

  return {
    isOpen: true,
    status: 'open',
    secondsRemaining: Math.ceil((closesMs - nowMs) / 1000),
  };
}

/**
 * Convenience wrapper: fetches DB time and combines it with a config row
 * (as read from raffle_config / vote_config) to produce the current window
 * state for a /status or enforcement check.
 */
export async function getWindowState(configRow) {
  const now = await getServerNow();
  return computeWindowState(
    { status: configRow.status, opensAt: configRow.opens_at, closesAt: configRow.closes_at },
    now
  );
}
