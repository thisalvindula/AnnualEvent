// Per-employee-ID lockout after repeated wrong-NIC attempts (requirement 9.2).
// In-memory by design: this is a single-app-instance deployment (see REQUIREMENTS.md
// section 2 non-goals). If the app is ever scaled to multiple instances sharing one
// database, this tracker should move to a shared store (e.g. a DB table) instead.

const MAX_ATTEMPTS = 3;
const LOCK_DURATION_MS = 5 * 60 * 1000; // "a few minutes"
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // stale attempt counters expire after this

const attemptsByEmpId = new Map(); // empId -> { count, firstAttemptAt, lockedUntil }

function cleanup(entry, now) {
  if (!entry) return null;
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    return null;
  }
  if (!entry.lockedUntil && now - entry.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    return null;
  }
  return entry;
}

export function isLocked(empId) {
  const now = Date.now();
  const entry = attemptsByEmpId.get(empId);
  if (!entry) return false;

  const alive = cleanup(entry, now);
  if (!alive) {
    attemptsByEmpId.delete(empId);
    return false;
  }
  return Boolean(alive.lockedUntil && alive.lockedUntil > now);
}

export function recordFailedAttempt(empId) {
  const now = Date.now();
  const existing = attemptsByEmpId.get(empId);
  const entry = cleanup(existing, now) ?? { count: 0, firstAttemptAt: now, lockedUntil: null };

  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCK_DURATION_MS;
  }
  attemptsByEmpId.set(empId, entry);
  return entry;
}

export function clearAttempts(empId) {
  attemptsByEmpId.delete(empId);
}

export const constants = { MAX_ATTEMPTS, LOCK_DURATION_MS, ATTEMPT_WINDOW_MS };
