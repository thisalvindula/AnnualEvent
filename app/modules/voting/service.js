import { createHash } from 'node:crypto';
import { verifyEmployeeCredentials } from '../../core/employees/index.js';
import { getWindowState, getServerNow } from '../../core/timewindow.js';
import { logEvent } from '../../core/audit/index.js';
import { publish } from '../../core/sse-hub.js';
import { verifyOwnPassword } from '../../core/auth/confirm.js';
import * as repo from './repo.js';

const REQUIRED_FINALISTS = 5;
const DEFAULT_DURATION_MINUTES = 15;
const CHANNEL = 'vote';
const TALLY_THROTTLE_MS = 1000; // requirement 9.4: push tallies at most once/sec

export async function getStatus() {
  const config = await repo.getConfig();
  const windowState = await getWindowState(config);
  const now = await getServerNow();
  return {
    serverTime: now,
    status: windowState.status,
    isOpen: windowState.isOpen,
    secondsRemaining: windowState.secondsRemaining,
  };
}

/**
 * Verify + "have they already voted" + the finalist list to choose from.
 * Never includes vote counts — employee phones must never see them
 * (requirement 3: "Vote visibility ... Voters' phones never see counts").
 */
export async function verify({ empId, last4, ip }) {
  const status = await getStatus();
  if (!status.isOpen) {
    return { ok: false, reason: 'closed', message: 'Voting is not open right now' };
  }

  const result = await verifyEmployeeCredentials({ empId, last4, ip, module: 'voting' });
  if (!result.ok) return result;

  const alreadyVoted = await repo.hasVoted(result.empId);
  if (alreadyVoted) {
    return { ok: false, reason: 'already_voted', message: 'You have already voted' };
  }

  const finalists = await repo.getFinalists();
  return {
    ok: true,
    empId: result.empId,
    name: result.name,
    finalists: finalists.map((f) => ({ id: f.id, name: f.name, song: f.song, position: f.position, empId: f.empId })),
  };
}

export async function cast({ empId, last4, finalistId, ip, userAgent }) {
  const status = await getStatus();
  if (!status.isOpen) {
    return { ok: false, reason: 'closed', message: 'Voting is not open right now' };
  }

  const verifyResult = await verifyEmployeeCredentials({ empId, last4, ip, module: 'voting' });
  if (!verifyResult.ok) return verifyResult;

  const finalists = await repo.getFinalists();
  if (!finalists.some((f) => f.id === finalistId)) {
    return { ok: false, reason: 'invalid_finalist', message: 'Not a valid finalist' };
  }

  const row = await repo.insertVote({ empId: verifyResult.empId, finalistId, ip, userAgent });
  if (!row) {
    return { ok: false, reason: 'already_voted', message: 'You have already voted' };
  }

  await logEvent({ module: 'voting', event: 'voted', empId: verifyResult.empId, ip });
  scheduleTallyPublish();

  return { ok: true, message: 'Vote recorded' };
}

let lastTallyPublish = 0;
let pendingTallyTimeout = null;

async function publishTally() {
  const tally = await repo.getTally();
  const totalVotes = tally.reduce((sum, f) => sum + f.votes, 0);
  publish(CHANNEL, 'tally', { tally, totalVotes });
}

function scheduleTallyPublish() {
  const now = Date.now();
  const elapsed = now - lastTallyPublish;
  if (elapsed >= TALLY_THROTTLE_MS) {
    lastTallyPublish = now;
    publishTally();
  } else if (!pendingTallyTimeout) {
    pendingTallyTimeout = setTimeout(() => {
      pendingTallyTimeout = null;
      lastTallyPublish = Date.now();
      publishTally();
    }, TALLY_THROTTLE_MS - elapsed);
  }
}

/** For the screen's initial load and the admin dashboard (not exposed to voters). */
export async function getTally() {
  const tally = await repo.getTally();
  const totalVotes = tally.reduce((sum, f) => sum + f.votes, 0);
  return { tally, totalVotes };
}

function validateFinalists(finalists) {
  if (!Array.isArray(finalists) || finalists.length !== REQUIRED_FINALISTS) {
    return `finalists must be an array of exactly ${REQUIRED_FINALISTS}`;
  }
  const positions = finalists.map((f) => f.position);
  const uniquePositions = new Set(positions);
  if (uniquePositions.size !== REQUIRED_FINALISTS || positions.some((p) => p < 1 || p > REQUIRED_FINALISTS)) {
    return `positions must be unique values 1-${REQUIRED_FINALISTS}`;
  }
  if (finalists.some((f) => typeof f.name !== 'string' || f.name.trim().length === 0)) {
    return 'every finalist needs a non-empty name';
  }
  return null;
}

export async function setFinalists(finalists) {
  const config = await repo.getConfig();
  if (config.status !== 'draft') {
    return { ok: false, message: 'Cannot change finalists once voting has started' };
  }

  const validationError = validateFinalists(finalists);
  if (validationError) {
    return { ok: false, message: validationError };
  }

  const ordered = [...finalists]
    .sort((a, b) => a.position - b.position)
    .map((f) => ({
      name: f.name.trim(),
      song: f.song ? String(f.song).trim() : null,
      position: f.position,
      empId: f.empId ? String(f.empId).trim() : null,
    }));

  try {
    await repo.replaceFinalists(ordered);
  } catch (err) {
    if (err.code === '23503') {
      return { ok: false, message: 'One or more emp_id values do not match an employee' };
    }
    throw err;
  }
  return { ok: true, finalists: ordered };
}

export async function setDuration(durationMinutes) {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return { ok: false, message: 'durationMinutes must be a positive number' };
  }
  const updated = await repo.setDurationMinutes(durationMinutes);
  if (!updated) {
    return { ok: false, message: 'Cannot change duration once voting has started' };
  }
  return { ok: true, config: updated };
}

export async function start({ ip, by } = {}) {
  const config = await repo.getConfig();
  if (!['draft', 'closed'].includes(config.status)) {
    return { ok: false, message: `Cannot start: voting status is "${config.status}"` };
  }

  const finalists = await repo.getFinalists();
  if (finalists.length !== REQUIRED_FINALISTS) {
    return { ok: false, message: `Configure all ${REQUIRED_FINALISTS} finalists before starting` };
  }

  const durationMinutes = config.duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const updated = await repo.setStatusOpen(durationMinutes);
  if (!updated) {
    return { ok: false, message: 'Voting could not be started (status changed concurrently)' };
  }

  await logEvent({ module: 'voting', event: 'started', ip, detail: { by, durationMinutes } });
  publish(CHANNEL, 'started', { opensAt: updated.opens_at, closesAt: updated.closes_at });
  return { ok: true, config: updated };
}

export async function close({ ip, by } = {}) {
  const updated = await repo.setStatusClosed();
  if (!updated) {
    return { ok: false, message: 'Voting is not currently open' };
  }
  await logEvent({ module: 'voting', event: 'closed', ip, detail: { by } });
  const { tally, totalVotes } = await getTally();
  publish(CHANNEL, 'closed', { closesAt: updated.closes_at, tally, totalVotes });
  return { ok: true, config: updated };
}

/**
 * Wipes cast votes (and optionally the finalist list) so voting can be
 * started again as a fresh run. Requires the operator to re-enter their own
 * password, since this is destructive and can't be undone. Refuses while
 * voting is currently open, so it can't wipe out live votes by accident —
 * close it first.
 */
export async function reset({ password, wipeFinalists = false, username, ip, by } = {}) {
  const passwordOk = await verifyOwnPassword(username, password);
  if (!passwordOk) {
    await logEvent({ module: 'voting', event: 'reset_denied', ip, detail: { by } });
    return { ok: false, message: 'Incorrect password' };
  }

  const config = await repo.getConfig();
  if (config.status === 'open') {
    return { ok: false, message: 'Close voting before resetting it' };
  }

  await repo.resetVoting({ wipeFinalists: Boolean(wipeFinalists) });
  await logEvent({ module: 'voting', event: 'reset', ip, detail: { by, wipeFinalists: Boolean(wipeFinalists) } });
  publish(CHANNEL, 'reset', { wipeFinalists: Boolean(wipeFinalists) });
  return { ok: true };
}

export async function exportResults({ ip, by } = {}) {
  const config = await repo.getConfig();
  if (config.status !== 'closed') {
    return { ok: false, message: 'Close voting before exporting results' };
  }

  const csv = await repo.exportVotesCsv();
  const { tally, totalVotes } = await getTally();
  const tallyCsv = repo.tallyToCsv(tally);
  const tallySha256 = createHash('sha256').update(tallyCsv).digest('hex');
  await logEvent({ module: 'voting', event: 'results_exported', ip, detail: { by, totalVotes, tallySha256 } });
  return { csv, tally, totalVotes, tallySha256 };
}
