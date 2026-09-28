import { requireRole } from '../../core/auth/middleware.js';
import { pages, sendPage } from '../../core/builtPages.js';
import * as service from './service.js';
import * as repo from './repo.js';

const OPERATOR_OR_AUDITOR = ['raffle_operator', 'auditor'];

const giftsSchema = {
  body: {
    type: 'object',
    required: ['gifts'],
    additionalProperties: false,
    properties: {
      gifts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'tier'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            tier: { type: 'string', enum: ['normal', 'premium'] },
          },
        },
      },
    },
  },
};

const openSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      windowMinutes: { type: 'number', exclusiveMinimum: 0 },
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
      wipeGifts: { type: 'boolean' },
    },
  },
};

export async function registerRaffleAdminRoutes(app) {
  app.get('/admin/raffle', { preHandler: requireRole('raffle_operator', 'auditor') }, async (request, reply) => {
    sendPage(reply, pages.adminRaffle);
  });

  app.get(
    '/admin/api/raffle/detail',
    { preHandler: requireRole(...OPERATOR_OR_AUDITOR) },
    async (request, reply) => {
      const status = await service.getStatus();
      const gifts = await repo.getGifts();
      return {
        status: status.status,
        entryCount: status.entryCount,
        secondsRemaining: status.secondsRemaining,
        giftsConfigured: gifts.length === 25,
        gifts,
      };
    }
  );

  // Read-only gift list for the admin "Lists" page; any logged-in admin.
  app.get('/admin/api/raffle/gifts', { preHandler: requireRole() }, async (request, reply) => {
    const gifts = await repo.getGifts();
    return { count: gifts.length, gifts };
  });

  app.post(
    '/admin/api/raffle/config',
    { onRequest: app.csrfProtection, preHandler: requireRole('raffle_operator'), schema: giftsSchema },
    async (request, reply) => {
      const result = await service.setGifts(request.body.gifts);
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.post(
    '/admin/api/raffle/open',
    { onRequest: app.csrfProtection, preHandler: requireRole('raffle_operator'), schema: openSchema },
    async (request, reply) => {
      const result = await service.open({
        windowMinutes: request.body.windowMinutes,
        ip: request.ip,
        by: request.adminSession.username,
      });
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.post(
    '/admin/api/raffle/close',
    { onRequest: app.csrfProtection, preHandler: requireRole('raffle_operator') },
    async (request, reply) => {
      const result = await service.close({ ip: request.ip, by: request.adminSession.username });
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.post(
    '/admin/api/raffle/reset',
    {
      onRequest: app.csrfProtection,
      preHandler: requireRole('raffle_operator'),
      schema: resetSchema,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = await service.reset({
        password: request.body.password,
        wipeGifts: request.body.wipeGifts,
        username: request.adminSession.username,
        ip: request.ip,
        by: request.adminSession.username,
      });
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.get(
    '/admin/api/raffle/registrations/export',
    { preHandler: requireRole(...OPERATOR_OR_AUDITOR) },
    async (request, reply) => {
      const result = await service.exportRegistrations({
        ip: request.ip,
        by: request.adminSession.username,
      });
      if (result.ok === false) {
        reply.code(400);
        return result;
      }
      const { csv, count, sha256 } = result;
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="raffle_registrations.csv"')
        .header('X-Entry-Count', String(count))
        .header('X-SHA-256', sha256)
        .send(csv);
    }
  );

  app.post(
    '/admin/api/raffle/draw/next',
    { onRequest: app.csrfProtection, preHandler: requireRole('raffle_operator') },
    async (request, reply) => {
      const result = await service.drawNext({ ip: request.ip, by: request.adminSession.username });
      if (!result.ok) reply.code(400);
      return result;
    }
  );

  app.get(
    '/admin/api/raffle/results/export',
    { preHandler: requireRole(...OPERATOR_OR_AUDITOR) },
    async (request, reply) => {
      const { csv, sha256 } = await service.exportResults({ ip: request.ip, by: request.adminSession.username });
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="raffle_results.csv"')
        .header('X-SHA-256', sha256)
        .send(csv);
    }
  );
}
