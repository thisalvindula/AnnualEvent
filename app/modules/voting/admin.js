import { requireRole } from '../../core/auth/middleware.js';
import { pages, sendPage } from '../../core/builtPages.js';
import { config as appConfig } from '../../core/config.js';
import * as service from './service.js';
import * as repo from './repo.js';

const finalistsSchema = {
  body: {
    type: 'object',
    required: ['finalists'],
    additionalProperties: false,
    properties: {
      finalists: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'position'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            song: { type: ['string', 'null'], maxLength: 200 },
            position: { type: 'integer', minimum: 1, maximum: 5 },
            empId: { type: ['string', 'null'], maxLength: 64 },
          },
        },
      },
    },
  },
};

const updateFinalistSchema = {
  params: {
    type: 'object',
    properties: { id: { type: 'integer', minimum: 1, maximum: 2147483647 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      song: { type: ['string', 'null'], maxLength: 200 },
      empId: { type: ['string', 'null'], maxLength: 64 },
    },
  },
};

const configSchema = {
  body: {
    type: 'object',
    required: ['durationMinutes'],
    additionalProperties: false,
    properties: {
      durationMinutes: { type: 'number', exclusiveMinimum: 0 },
    },
  },
};

const resetSchema = {
  body: {
    type: 'object',
    required: ['password'],
    additionalProperties: false,
    properties: {
      password: { type: 'string', minLength: 1, maxLength: 200 },
      wipeFinalists: { type: 'boolean' },
    },
  },
};

export async function registerVotingAdminRoutes(app) {
  app.get('/admin/vote', { preHandler: requireRole('vote_operator', 'auditor') }, async (request, reply) => {
    sendPage(reply, pages.adminVote);
  });

  app.get(
    '/admin/api/vote/detail',
    { preHandler: requireRole('vote_operator', 'auditor') },
    async (request, reply) => {
      const config = await repo.getConfig();
      const finalists = await repo.getFinalists();
      const { tally, totalVotes } = await service.getTally();
      const { secondsRemaining } = await service.getStatus();
      return {
        screenPath: `/screen/vote?token=${encodeURIComponent(appConfig.screenTokens.vote)}`,
        status: config.status,
        durationMinutes: config.duration_minutes,
        // 0 while status is still 'open' means the timer has run out but nobody has pressed "close" yet.
        secondsRemaining,
        finalistsConfigured: finalists.length === 5,
        finalists,
        tally,
        totalVotes,
      };
    }
  );

  // Read-only finalist list for the admin "Lists" page; any logged-in admin.
  app.get('/admin/api/vote/finalists', { preHandler: requireRole() }, async (request, reply) => {
    const finalists = await repo.getFinalists();
    return { count: finalists.length, finalists };
  });

  app.post(
    '/admin/api/vote/finalists',
    { onRequest: app.csrfProtection, preHandler: requireRole('vote_operator'), schema: finalistsSchema },
    async (request, reply) => {
      const result = await service.setFinalists(request.body.finalists);
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.put(
    '/admin/api/vote/finalists/:id',
    { onRequest: app.csrfProtection, preHandler: requireRole('vote_operator'), schema: updateFinalistSchema },
    async (request, reply) => {
      const result = await service.updateFinalist(request.params.id, request.body, {
        ip: request.ip,
        by: request.adminSession.username,
      });
      reply.code(result.ok ? 200 : result.reason === 'not_found' ? 404 : 400);
      return result;
    }
  );

  app.post(
    '/admin/api/vote/config',
    { onRequest: app.csrfProtection, preHandler: requireRole('vote_operator'), schema: configSchema },
    async (request, reply) => {
      const result = await service.setDuration(request.body.durationMinutes);
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.post(
    '/admin/api/vote/start',
    { onRequest: app.csrfProtection, preHandler: requireRole('vote_operator') },
    async (request, reply) => {
      const result = await service.start({ ip: request.ip, by: request.adminSession.username });
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.post(
    '/admin/api/vote/close',
    { onRequest: app.csrfProtection, preHandler: requireRole('vote_operator') },
    async (request, reply) => {
      const result = await service.close({ ip: request.ip, by: request.adminSession.username });
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.post(
    '/admin/api/vote/reset',
    {
      onRequest: app.csrfProtection,
      preHandler: requireRole('vote_operator'),
      schema: resetSchema,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = await service.reset({
        password: request.body.password,
        wipeFinalists: request.body.wipeFinalists,
        username: request.adminSession.username,
        ip: request.ip,
        by: request.adminSession.username,
      });
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.get(
    '/admin/api/vote/results/export',
    { preHandler: requireRole('auditor') },
    async (request, reply) => {
      const result = await service.exportResults({
        ip: request.ip,
        by: request.adminSession.username,
      });
      if (result.ok === false) {
        reply.code(400);
        return result;
      }
      const { csv, totalVotes, tallySha256 } = result;
      // Tally itself is visible on the admin/screen dashboards and can be
      // recomputed from the CSV; headers only carry the audit-relevant
      // count + hash (kept ASCII-safe, unlike finalist names/songs).
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="votes.csv"')
        .header('X-Total-Votes', String(totalVotes))
        .header('X-SHA-256', tallySha256)
        .send(csv);
    }
  );
}
