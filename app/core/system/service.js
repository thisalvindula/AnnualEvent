import { verifyOwnPassword } from '../auth/confirm.js';
import { logEvent } from '../audit/index.js';
import { publish } from '../sse-hub.js';
import * as repo from './repo.js';

/**
 * Wipes employees + all raffle/voting data so the event can start completely
 * fresh, keeping admin_users and audit_log intact. Requires the admin to
 * re-enter their own password, since this is destructive and can't be
 * undone. Refuses while either module is currently open, so it can't wipe
 * out live entries/votes by accident — close both first.
 */
export async function clearDatabase({ password, username, ip, by } = {}) {
  const passwordOk = await verifyOwnPassword(username, password);
  if (!passwordOk) {
    await logEvent({ module: 'core', event: 'full_clear_denied', ip, detail: { by } });
    return { ok: false, message: 'Incorrect password' };
  }

  const { raffleStatus, voteStatus } = await repo.getModuleStatuses();
  if (raffleStatus === 'open') {
    return { ok: false, message: 'Close the raffle before clearing the database' };
  }
  if (voteStatus === 'open') {
    return { ok: false, message: 'Close voting before clearing the database' };
  }

  await repo.clearAllData();
  await logEvent({ module: 'core', event: 'full_clear', ip, detail: { by } });
  publish('raffle', 'reset', { wipeGifts: true });
  publish('vote', 'reset', { wipeFinalists: true });
  return { ok: true };
}
