// Stateless admin sessions: a signed cookie carrying {id, username, role, iat}.
// Signed (HMAC via @fastify/cookie + SESSION_SECRET) so it can't be forged or
// tampered with, HttpOnly/Secure/SameSite=Lax so it can't be read or replayed
// cross-site. There is no server-side session table in the schema (section 8),
// so logout simply clears the cookie; a stolen cookie remains valid until it
// expires, which SESSION_MAX_AGE_MS keeps short.

const COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

export function issueSession(reply, adminUser) {
  const payload = {
    id: adminUser.id,
    username: adminUser.username,
    role: adminUser.role,
    iat: Date.now(),
  };
  reply.setCookie(COOKIE_NAME, JSON.stringify(payload), {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    signed: true,
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
}

export function clearSession(reply) {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export function readSession(request) {
  const raw = request.cookies?.[COOKIE_NAME];
  if (!raw) return null;

  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;

  try {
    const payload = JSON.parse(unsigned.value);
    if (Date.now() - payload.iat > SESSION_MAX_AGE_MS) return null;
    if (!payload.id || !payload.username || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

export const cookieName = COOKIE_NAME;
