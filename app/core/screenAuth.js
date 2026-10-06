import { config } from './config.js';

// Big screens are read-only and hold the only SSE connections (requirement 9.5).
// Access requires a secret token in the URL plus an allowed-IP list, both from
// .env. Shared by every module's /screen/<module> and /screen/<module>/stream
// routes so the rule can't drift between modules.

function ipAllowed(ip) {
  if (config.screenAllowedIps.length === 0) return true;
  return config.screenAllowedIps.includes(ip);
}

export function requireScreenAccess(expectedToken) {
  return async (request, reply) => {
    const token = request.query?.token;
    if (typeof token !== 'string' || token.length === 0 || token !== expectedToken) {
      reply.code(403).send({ error: 'forbidden' });
      return reply;
    }
    if (!ipAllowed(request.ip)) {
      request.log.warn({ ip: request.ip }, 'screen access denied: IP not in SCREEN_ALLOWED_IPS');
      reply.code(403).send({ error: 'forbidden' });
      return reply;
    }
  };
}
