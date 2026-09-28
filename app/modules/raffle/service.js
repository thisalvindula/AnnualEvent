import { randomInt, createHash } from 'node:crypto';
import { verifyEmployeeCredentials, findEmployeeById } from '../../core/employees/index.js';
import { getWindowState, getServerNow } from '../../core/timewindow.js';
import { logEvent } from '../../core/audit/index.js';
import { publish } from '../../core/sse-hub.js';
import { verifyOwnPassword } from '../../core/auth/confirm.js';
import * as repo from './repo.js';

const REQUIRED_NORMAL_GIFTS = 10;
const REQUIRED_PREMIUM_GIFTS = 15;
const DEFAULT_WINDOW_MINUTES = 15;
const CHANNEL = 'raffle';

export async function getStatus() {
  const config = await repo.getConfig();
  const windowState = await getWindowState(config);
  const entryCount = await repo.getRegistrationCount();
  const now = await getServerNow();
  return {
    serverTime: now,
    status: windowState.status,
    isOpen: windowState.isOpen,
    secondsRemaining: windowState.secondsRemaining,
    entryCount,
  };
}

export async function verify({ empId, last4, ip }) {
  const status = await getStatus();
  if (!status.isOpen) {
    return { ok: false, reason: 'closed', message: 'Raffle registration is not open right now' };
  }
  return verifyEmployeeCredentials({ empId, last4, ip, module: 'raffle' });
}

export async function register({ empId, last4, ip, userAgent }) {
  const status = await getStatus();
  if (!status.isOpen) {
    return { ok: false, reason: 'closed', message: 'Raffle registration is not open right now' };
  }

  const verifyResult = await verifyEmployeeCredentials({ empId, last4, ip, module: 'raffle' });
  if (!verifyResult.ok) {
    return verifyResult;
  }

  const row = await repo.insertRegistration({ empId: verifyResult.empId, ip, userAgent });
  if (!row) {
    return { ok: false, reason: 'already_registered', message: 'You are already registered' };
  }

  await logEvent({ module: 'raffle', event: 'registered', empId: verifyResult.empId, ip, detail: { ticketNo: row.ticket_no } });

  const entryCount = await repo.getRegistrationCount();
  publish(CHANNEL, 'entry_count', { entryCount });

  return { ok: true, ticketNo: row.ticket_no, name: verifyResult.name };
}

function validateGiftComposition(gifts) {
  if (!Array.isArray(gifts) || gifts.length === 0) {
    return 'gifts must be a non-empty array';
  }
  const normal = gifts.filter((g) => g.tier === 'normal');
  const premium = gifts.filter((g) => g.tier === 'premium');
  if (normal.length !== REQUIRED_NORMAL_GIFTS || premium.length !== REQUIRED_PREMIUM_GIFTS) {
    return `gifts must be exactly ${REQUIRED_NORMAL_GIFTS} normal and ${REQUIRED_PREMIUM_GIFTS} premium (got ${normal.length} normal, ${premium.length} premium)`;
  }
  if (gifts.some((g) => typeof g.name !== 'string' || g.name.trim().length === 0)) {
    return 'every gift needs a non-empty name';
  }
  return null;
}

export async function setGifts(gifts) {
  const config = await repo.getConfig();
  if (config.status !== 'draft') {
    return { ok: false, message: 'Cannot change the gift list once the raffle has opened' };
  }

  const validationError = validateGiftComposition(gifts);
  if (validationError) {
    return { ok: false, message: validationError };
  }

  // Draw order: normal gifts first, premium gifts last (requirement 9.3).
  const normal = gifts.filter((g) => g.tier === 'normal');
  const premium = gifts.filter((g) => g.tier === 'premium');
  const ordered = [...normal, ...premium].map((g, i) => ({ name: g.name.trim(), tier: g.tier, seq: i + 1 }));

  await repo.replaceGifts(ordered);
  return { ok: true, gifts: ordered };
}

export async function open({ windowMinutes = DEFAULT_WINDOW_MINUTES, ip, by } = {}) {
  const config = await repo.getConfig();
  if (config.status === 'open') {
    return { ok: false, message: `Cannot open: raffle status is "${config.status}"` };
  }

  const gifts = await repo.getGifts();
  if (gifts.length !== REQUIRED_NORMAL_GIFTS + REQUIRED_PREMIUM_GIFTS) {
    return { ok: false, message: 'Configure the full 25-gift list before opening' };
  }

  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return { ok: false, message: 'windowMinutes must be a positive number' };
  }

  const updated = await repo.setStatusOpen(Math.round(windowMinutes * 60));
  if (!updated) {
    return { ok: false, message: 'Raffle could not be opened (status changed concurrently)' };
  }

  await logEvent({ module: 'raffle', event: 'opened', ip, detail: { by, windowMinutes } });
  publish(CHANNEL, 'opened', { opensAt: updated.opens_at, closesAt: updated.closes_at });
  return { ok: true, config: updated };
}

export async function close({ ip, by } = {}) {
  const updated = await repo.setStatusClosed();
  if (!updated) {
    return { ok: false, message: 'Raffle is not currently open' };
  }
  await logEvent({ module: 'raffle', event: 'closed', ip, detail: { by } });
  publish(CHANNEL, 'closed', { closesAt: updated.closes_at });
  return { ok: true, config: updated };
}

/**
 * Wipes entries/draws (and optionally the gift list) so the raffle can be
 * opened again as a fresh run. Requires the operator to re-enter their own
 * password, since this is destructive and can't be undone. Refuses while
 * the raffle is currently open, so it can't wipe out live registrations by
 * accident — close it first.
 */
export async function reset({ password, wipeGifts = false, username, ip, by } = {}) {
  const passwordOk = await verifyOwnPassword(username, password);
  if (!passwordOk) {
    await logEvent({ module: 'raffle', event: 'reset_denied', ip, detail: { by } });
    return { ok: false, message: 'Incorrect password' };
  }

  const config = await repo.getConfig();
  if (config.status === 'open') {
    return { ok: false, message: 'Close the raffle before resetting it' };
  }

  await repo.resetRaffle({ wipeGifts: Boolean(wipeGifts) });
  await logEvent({ module: 'raffle', event: 'reset', ip, detail: { by, wipeGifts: Boolean(wipeGifts) } });
  publish(CHANNEL, 'reset', { wipeGifts: Boolean(wipeGifts) });
  return { ok: true };
}

export async function exportRegistrations({ ip, by } = {}) {
  const config = await repo.getConfig();
  if (config.status !== 'closed') {
    return { ok: false, message: 'Close registration before sealing the list' };
  }

  const { csv, count } = await repo.exportRegistrationsCsv();
  const sha256 = createHash('sha256').update(csv).digest('hex');
  await logEvent({ module: 'raffle', event: 'registrations_exported', ip, detail: { by, count, sha256 } });
  publish(CHANNEL, 'registrations_sealed', { count, sha256 });
  return { csv, count, sha256 };
}

/**
 * Draws one winner for the next undrawn gift. Uses crypto.randomInt (never
 * Math.random) for the pick, and relies on the atomic INSERT ... ON CONFLICT
 * DO NOTHING patterns in repo.js as the concurrency backstop, retrying a few
 * times if a concurrent draw changed state underneath it (requirement 9.3).
 */
export async function drawNext({ ip, by } = {}) {
  const config = await repo.getConfig();
  if (config.status !== 'closed') {
    return { ok: false, message: 'Close registration before drawing' };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const gift = await repo.getNextUndrawnGift();
    if (!gift) {
      return { ok: false, message: 'All gifts have been drawn' };
    }

    const eligible = await repo.getEligibleEmpIds();
    if (eligible.length === 0) {
      return { ok: false, message: 'No eligible entrants remain' };
    }

    const winnerEmpId = eligible[randomInt(0, eligible.length)];
    const result = await repo.insertDrawResult({ seq: gift.seq, empId: winnerEmpId });
    if (!result) {
      // Lost a race with a concurrent draw for the same gift/winner; retry with fresh state.
      continue;
    }

    const winner = await findEmployeeById(winnerEmpId);
    const winnerName = winner?.name ?? winnerEmpId;

    await logEvent({
      module: 'raffle',
      event: 'draw',
      empId: winnerEmpId,
      ip,
      detail: { by, seq: gift.seq, gift: gift.name, tier: gift.tier },
    });

    const remaining = REQUIRED_NORMAL_GIFTS + REQUIRED_PREMIUM_GIFTS - (await repo.getDrawResultsCount());
    publish(CHANNEL, 'winner', {
      seq: gift.seq,
      gift: gift.name,
      tier: gift.tier,
      empId: winnerEmpId,
      name: winnerName,
      remaining,
    });

    return { ok: true, seq: gift.seq, gift: gift.name, tier: gift.tier, empId: winnerEmpId, name: winnerName, remaining };
  }

  return { ok: false, message: 'Could not draw a winner after several attempts, please retry' };
}

export async function exportResults({ ip, by } = {}) {
  const csv = await repo.exportResultsCsv();
  const sha256 = createHash('sha256').update(csv).digest('hex');
  await logEvent({ module: 'raffle', event: 'results_exported', ip, detail: { by, sha256 } });
  return { csv, sha256 };
}
