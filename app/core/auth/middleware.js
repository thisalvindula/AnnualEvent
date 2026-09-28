import { readSession } from './session.js';

/**
 * Populates request.adminSession (or null) on every request. Register once
 * on the app; individual routes then use requireRole() to enforce access.
 */
export function registerSessionDecorator(app) {
  app.decorateRequest('adminSession', null);
  app.addHook('onRequest', async (request) => {
    request.adminSession = readSession(request);
  });
}

/**
 * Route preHandler: rejects unauthenticated requests, and (when roles are
 * given) rejects sessions whose role isn't in the allowed list.
 * Use requireRole() with no args to just require "any logged-in admin".
 */
export function requireRole(...roles) {
  return async (request, reply) => {
    if (!request.adminSession) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (roles.length > 0 && !roles.includes(request.adminSession.role)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  };
}
