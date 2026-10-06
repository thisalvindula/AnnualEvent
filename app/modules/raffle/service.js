import { randomInt, createHash } from 'node:crypto';
import { verifyEmployeeCredentials, findEmployeeById } from '../../core/employees/index.js';
import { getWindowState, getServerNow } from '../../core/timewindow.js';
import { logEvent } from '../../core/audit/index.js';
import { publish } from '../../core/sse-hub.js';
import { verifyOwnPassword } from '../../core/auth/confirm.js';
import * as repo from './repo.js';

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

function cleanGiftInput({ id, place, quantity, description, section }) {
  const cleaned = {
    id,
    place: typeof place === 'string' ? place.trim() : '',
    quantity,
    description: typeof description === 'string' ? description.trim() : '',
    section,
  };
  if (!Number.isInteger(cleaned.id) || cleaned.id < 1) return { error: 'Gift id must be a whole number, 1 or more' };
  if (!cleaned.place) return { error: 'Gift place is required (e.g. "1st place")' };
  if (!Number.isInteger(cleaned.quantity) || cleaned.quantity < 1) return { error: 'Quantity must be a whole number, 1 or more' };
  if (!cleaned.description) return { error: 'Gift description is required' };
  if (cleaned.section !== 'podium' && cleaned.section !== 'consolation') return { error: 'Section must be podium or consolation' };
  if (cleaned.section === 'podium' && cleaned.quantity !== 1) return { error: 'A podium prize has exactly one winner — set the quantity to 1 or use the consolation row' };
  return { gift: cleaned };
}

/**
 * The gift list is freely editable at any time (draft, open, or mid-draw) so
 * mistakes can always be fixed; the only limits protect draws already made:
 * a gift can't be deleted, or have its quantity cut below its drawn winners.
 * Draw order is ascending gift id.
 */
export async function createGift(input, { ip, by } = {}) {
  const { gift, error } = cleanGiftInput({ ...input, section: input.section ?? (input.quantity === 1 ? 'podium' : 'consolation') });
  if (error) return { ok: false, message: error };

  const created = await repo.insertGift(gift);
  if (!created) return { ok: false, reason: 'exists', message: `A gift with id ${gift.id} already exists` };

  await logEvent({ module: 'raffle', event: 'gift_created', ip, detail: { by, ...gift } });
  return { ok: true, gift: created };
}

export async function updateGift(id, input, { ip, by } = {}) {
  const existing = await repo.getGift(id);
  if (!existing) return { ok: false, reason: 'not_found', message: `Gift ${id} not found` };

  const { gift, error } = cleanGiftInput({
    id: input.id ?? id,
    place: input.place ?? existing.place,
    quantity: input.quantity ?? existing.quantity,
    description: input.description ?? existing.description,
    section: input.section ?? existing.section,
  });
  if (error) return { ok: false, message: error };
  if (gift.quantity < existing.drawn) {
    return {
      ok: false,
      message: `${existing.drawn} winner${existing.drawn === 1 ? ' has' : 's have'} already been drawn for this gift, so the quantity can't go below ${existing.drawn}`,
    };
  }

  let updated;
  try {
    updated = await repo.updateGift(id, { newId: gift.id, ...gift });
  } catch (err) {
    if (err.code === '23505') return { ok: false, reason: 'exists', message: `A gift with id ${gift.id} already exists` };
    throw err;
  }
  if (!updated) return { ok: false, reason: 'not_found', message: `Gift ${id} not found` };

  await logEvent({
    module: 'raffle',
    event: 'gift_updated',
    ip,
    detail: {
      by,
      id,
      from: { id: existing.id, place: existing.place, quantity: existing.quantity, description: existing.description, section: existing.section },
      to: gift,
    },
  });
  return { ok: true, gift: updated };
}

export async function deleteGift(id, { ip, by } = {}) {
  const existing = await repo.getGift(id);
  if (!existing) return { ok: false, reason: 'not_found', message: `Gift ${id} not found` };
  if (existing.drawn > 0) {
    return { ok: false, reason: 'in_use', message: 'Winners have already been drawn for this gift, so it can\'t be deleted' };
  }

  try {
    await repo.deleteGift(id);
  } catch (err) {
    if (err.code === '23503') {
      return { ok: false, reason: 'in_use', message: 'Winners have already been drawn for this gift, so it can\'t be deleted' };
    }
    throw err;
  }
  await logEvent({ module: 'raffle', event: 'gift_deleted', ip, detail: { by, ...existing } });
  return { ok: true };
}

export async function open({ windowMinutes = DEFAULT_WINDOW_MINUTES, ip, by } = {}) {
  const config = await repo.getConfig();
  if (config.status === 'open') {
    return { ok: false, message: `Cannot open: raffle status is "${config.status}"` };
  }

  const { totalPrizes } = await repo.getPrizeProgress();
  if (totalPrizes === 0) {
    return { ok: false, message: 'Configure the gift list before opening' };
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

/** Prize totals for the big screen (kept out of the public status so employee polling stays light). */
export async function getProgress() {
  const [progress, gifts, winners] = await Promise.all([repo.getPrizeProgress(), repo.getGifts(), repo.getAllDrawResults()]);
  return { ...progress, gifts: gifts.map(layoutGift), winners: winners.map(layoutWinner) };
}

const layoutGift = (g) => ({ id: g.id, place: g.place, description: g.description, quantity: g.quantity, section: g.section });
const layoutWinner = (r) => ({ giftId: r.gift_id, slot: r.slot, empId: r.emp_id, name: r.name, imageName: r.image_name });

/**
 * Everything the raffle screen (and the admin raffle page) need to resume
 * correctly after a reload: prize totals, the most recent winners, and the
 * last sealed-list banner — all read back from durable storage, so a screen
 * that reconnects mid-draw (or after sealing) shows the same thing it would
 * have if it had never disconnected.
 */
export async function getSnapshot() {
  const [{ totalPrizes, drawnCount, gifts, winners }, recent, seal] = await Promise.all([
    getProgress(),
    repo.getRecentDrawResults(6),
    repo.getLastSeal(),
  ]);
  const recentWinners = recent.map((r) => ({
    giftId: r.gift_id,
    place: r.place,
    description: r.description,
    quantity: r.quantity,
    slot: r.slot,
    empId: r.emp_id,
    name: r.name,
    imageName: r.image_name,
    drawnAt: r.drawn_at,
  }));
  return { totalPrizes, drawnCount, gifts, winners, recentWinners, sealed: seal };
}

/** Registered entrants' display names only — used by the screen's draw
 * animation to shuffle through real entries instead of random characters. */
export async function getEntrantNames() {
  return repo.getEntrantNames();
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
 * Draws one winner for the next gift that still has winners left (ascending gift id). Uses crypto.randomInt (never
 * Math.random) for the pick, and relies on the atomic INSERT ... ON CONFLICT
 * DO NOTHING patterns in repo.js as the concurrency backstop, retrying a few
 * times if a concurrent draw changed state underneath it (requirement 9.3).
 */
export async function drawNext({ ip, by } = {}) {
  const config = await repo.getConfig();
  if (config.status !== 'closed') {
    return { ok: false, message: 'Close registration before drawing' };
  }

  const seal = await repo.getLastSeal();
  if (!seal) {
    return { ok: false, message: 'Lock the entry list before drawing' };
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
    const slot = gift.drawn + 1;
    const result = await repo.insertDrawResult({ giftId: gift.id, slot, empId: winnerEmpId });
    if (!result) {
      // Lost a race with a concurrent draw for the same gift slot/winner; retry with fresh state.
      continue;
    }

    const winner = await findEmployeeById(winnerEmpId);
    const winnerName = winner?.name ?? winnerEmpId;

    await logEvent({
      module: 'raffle',
      event: 'draw',
      empId: winnerEmpId,
      ip,
      detail: { by, giftId: gift.id, slot, place: gift.place, description: gift.description },
    });

    const { totalPrizes, drawnCount } = await repo.getPrizeProgress();
    const payload = {
      giftId: gift.id,
      place: gift.place,
      description: gift.description,
      slot,
      quantity: gift.quantity,
      section: gift.section,
      empId: winnerEmpId,
      name: winnerName,
      imageName: winner?.image_name ?? null,
      drawnCount,
      totalPrizes,
      remaining: totalPrizes - drawnCount,
    };
    publish(CHANNEL, 'winner', payload);

    return { ok: true, ...payload };
  }

  return { ok: false, message: 'Could not draw a winner after several attempts, please retry' };
}

export async function exportResults({ ip, by } = {}) {
  const csv = await repo.exportResultsCsv();
  const sha256 = createHash('sha256').update(csv).digest('hex');
  await logEvent({ module: 'raffle', event: 'results_exported', ip, detail: { by, sha256 } });
  return { csv, sha256 };
}
