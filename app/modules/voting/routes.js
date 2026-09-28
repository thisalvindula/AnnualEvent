import { config } from '../../core/config.js';
import { requireScreenAccess } from '../../core/screenAuth.js';
import { subscribe, sendTo } from '../../core/sse-hub.js';
import { pages, sendPage } from '../../core/builtPages.js';
import * as service from './service.js';

const verifySchema = {
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

const castSchema = {
  body: {
    type: 'object',
    required: ['empId', 'last4', 'finalistId'],
    additionalProperties: false,
    properties: {
      empId: { type: 'string', minLength: 1, maxLength: 64 },
      last4: { type: 'string', minLength: 1, maxLength: 8 },
      finalistId: { type: 'integer' },
    },
  },
};

export async function registerVotingRoutes(app) {
  app.get('/vote', async (request, reply) => {
    sendPage(reply, pages.voteVote);
  });

  app.get('/vote/api/status', async () => {
    return service.getStatus();
  });

  app.post('/vote/api/verify', { schema: verifySchema }, async (request, reply) => {
    const { empId, last4 } = request.body;
    const result = await service.verify({ empId, last4, ip: request.ip });
    if (!result.ok) {
      reply.code(result.reason === 'closed' ? 403 : result.reason === 'already_voted' ? 409 : 401);
    }
    return result;
  });

  app.post('/vote/api/cast', { schema: castSchema }, async (request, reply) => {
    const { empId, last4, finalistId } = request.body;
    const result = await service.cast({
      empId,
      last4,
      finalistId,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    if (!result.ok) {
      reply.code(
        result.reason === 'closed'
          ? 403
          : result.reason === 'already_voted'
            ? 409
            : result.reason === 'invalid_finalist'
              ? 400
              : 401
      );
    }
    return result;
  });

  app.get(
    '/screen/vote',
    { preHandler: requireScreenAccess(config.screenTokens.vote) },
    async (request, reply) => {
      sendPage(reply, pages.voteScreen);
    }
  );

  app.get(
    '/screen/vote/stream',
    { preHandler: requireScreenAccess(config.screenTokens.vote) },
    async (request, reply) => {
      subscribe('vote', request, reply);
      const { tally, totalVotes } = await service.getTally();
      sendTo(reply, 'tally', { tally, totalVotes });
      return reply;
    }
  );
}
