import { requireRole } from '../../core/auth/middleware.js';
import { pages, sendPage } from '../../core/builtPages.js';
import { config } from '../../core/config.js';
import * as service from './service.js';
import * as repo from './repo.js';

const OPERATOR_OR_AUDITOR = ['raffle_operator', 'auditor'];

const giftBodyProperties = {
  id: { type: 'integer', minimum: 1, maximum: 2147483647 },
  place: { type: 'string', minLength: 1, maxLength: 100 },
  quantity: { type: 'integer', minimum: 1, maximum: 100000 },
  description: { type: 'string', minLength: 1, maxLength: 500 },
  section: { type: 'string', enum: ['podium', 'consolation'] },
};

const createGiftSchema = {
  body: {
    type: 'object',
    required: ['id', 'place', 'quantity', 'description'],
    additionalProperties: false,
    properties: giftBodyProperties,
  },
};

const updateGiftSchema = {
  params: {
    type: 'object',
    properties: { id: { type: 'integer', minimum: 1, maximum: 2147483647 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: giftBodyProperties,
  },
};

const deleteGiftSchema = { params: updateGiftSchema.params };

function giftResultStatus(result) {
  if (result.ok) return 200;
  if (result.reason === 'not_found') return 404;
  if (result.reason === 'exists' || result.reason === 'in_use') return 409;
  return 400;
}

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
      const snapshot = await service.getSnapshot();
      return {
        screenPath: `/screen/raffle?token=${encodeURIComponent(config.screenTokens.raffle)}`,
        status: status.status,
        entryCount: status.entryCount,
        secondsRemaining: status.secondsRemaining,
        giftsConfigured: gifts.length > 0,
        totalPrizes: gifts.reduce((sum, g) => sum + g.quantity, 0),
        gifts,
        sealed: snapshot.sealed,
        recentWinners: snapshot.recentWinners,
      };
    }
  );

  // Read-only gift list for the admin "Lists" page; any logged-in admin.
  app.get('/admin/api/raffle/gifts', { preHandler: requireRole() }, async (request, reply) => {
    const gifts = await repo.getGifts();
    return { count: gifts.length, totalPrizes: gifts.reduce((sum, g) => sum + g.quantity, 0), gifts };
  });

  app.post(
    '/admin/api/raffle/gifts',
    { onRequest: app.csrfProtection, preHandler: requireRole('raffle_operator'), schema: createGiftSchema },
    async (request, reply) => {
      const result = await service.createGift(request.body, { ip: request.ip, by: request.adminSession.username });
      reply.code(result.ok ? 201 : giftResultStatus(result));
      return result;
    }
  );

  app.put(
    '/admin/api/raffle/gifts/:id',
    { onRequest: app.csrfProtection, preHandler: requireRole('raffle_operator'), schema: updateGiftSchema },
    async (request, reply) => {
      const result = await service.updateGift(request.params.id, request.body, {
        ip: request.ip,
        by: request.adminSession.username,
      });
      reply.code(giftResultStatus(result));
      return result;
    }
  );

  app.delete(
    '/admin/api/raffle/gifts/:id',
    { onRequest: app.csrfProtection, preHandler: requireRole('raffle_operator'), schema: deleteGiftSchema },
    async (request, reply) => {
      const result = await service.deleteGift(request.params.id, {
        ip: request.ip,
        by: request.adminSession.username,
      });
      reply.code(giftResultStatus(result));
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
