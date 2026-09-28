import { config } from '../../core/config.js';
import { requireScreenAccess } from '../../core/screenAuth.js';
import { subscribe } from '../../core/sse-hub.js';
import { pages, sendPage } from '../../core/builtPages.js';
import * as service from './service.js';

const credentialsSchema = {
  body: {
    type: 'object',
    required: ['empId', 'last4'],
    additionalProperties: false,
    properties: {
      empId: { type: 'string', minLength: 1, maxLength: 64 },
      last4: { type: 'string', minLength: 1, maxLength: 8 },
    },
  },
};

export async function registerRaffleRoutes(app) {
  app.get('/raffle', async (request, reply) => {
    sendPage(reply, pages.raffleRegister);
  });

  app.get('/raffle/api/status', async () => {
    return service.getStatus();
  });

  app.post('/raffle/api/verify', { schema: credentialsSchema }, async (request, reply) => {
    const { empId, last4 } = request.body;
    const result = await service.verify({ empId, last4, ip: request.ip });
    if (!result.ok) reply.code(result.reason === 'closed' ? 403 : 401);
    return result;
  });

  app.post('/raffle/api/register', { schema: credentialsSchema }, async (request, reply) => {
    const { empId, last4 } = request.body;
    const result = await service.register({
      empId,
      last4,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    if (!result.ok) {
      reply.code(result.reason === 'closed' ? 403 : result.reason === 'already_registered' ? 409 : 401);
    }
    return result;
  });

  app.get(
    '/screen/raffle',
    { preHandler: requireScreenAccess(config.screenTokens.raffle) },
    async (request, reply) => {
      sendPage(reply, pages.raffleScreen);
    }
  );

  app.get(
    '/screen/raffle/stream',
    { preHandler: requireScreenAccess(config.screenTokens.raffle) },
    async (request, reply) => {
      subscribe('raffle', request, reply);
      return reply;
    }
  );
}
