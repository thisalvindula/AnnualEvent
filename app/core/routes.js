import { logEvent, exportAuditCsv } from './audit/index.js';
import { findAdminByUsername } from './auth/repo.js';
import { verifyPassword } from './auth/passwords.js';
import { issueSession, clearSession } from './auth/session.js';
import { requireRole } from './auth/middleware.js';
import { pages, sendPage } from './builtPages.js';
import { parseEmployeeCsv, importEmployees, listEmployees } from './employees/index.js';
import * as systemService from './system/service.js';

const clearDatabaseSchema = {
  body: {
    type: 'object',
    required: ['password'],
    additionalProperties: false,
    properties: {
      password: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
};

export async function registerCoreRoutes(app) {
  app.get('/admin/login', async (request, reply) => {
    sendPage(reply, pages.adminLogin);
  });

  // Unauthenticated, same trust model as the CSRF token the /admin/login GET
  // handler above already hands out before any session exists — the React
  // admin app needs a token before login too, so this is the uniform source.
  app.get('/admin/api/csrf', async (request, reply) => {
    const csrfToken = await reply.generateCsrf();
    return { csrfToken };
  });

  app.get('/admin/api/me', { preHandler: requireRole() }, async (request, reply) => {
    const { username, role } = request.adminSession;
    return { username, role };
  });

  app.post(
    '/admin/login',
    {
      onRequest: app.csrfProtection,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { username, password } = request.body ?? {};
      const ip = request.ip;

      if (typeof username !== 'string' || typeof password !== 'string') {
        reply.code(400);
        return { message: 'Username and password are required' };
      }

      const admin = await findAdminByUsername(username);
      const genericFailure = { message: 'Invalid username or password' };

      if (!admin) {
        await logEvent({ module: 'core', event: 'admin_login_unknown_user', ip, detail: { username } });
        reply.code(401);
        return genericFailure;
      }

      const match = await verifyPassword(admin.password_hash, password);
      if (!match) {
        await logEvent({ module: 'core', event: 'admin_login_failure', ip, detail: { username } });
        reply.code(401);
        return genericFailure;
      }

      issueSession(reply, admin);
      await logEvent({ module: 'core', event: 'admin_login_success', ip, detail: { username, role: admin.role } });
      return { ok: true, role: admin.role };
    }
  );

  app.post('/admin/logout', { onRequest: app.csrfProtection }, async (request, reply) => {
    clearSession(reply);
    if (request.adminSession) {
      await logEvent({ module: 'core', event: 'admin_logout', ip: request.ip, detail: { username: request.adminSession.username } });
    }
    return { ok: true };
  });

  app.get('/admin', { preHandler: requireRole() }, async (request, reply) => {
    sendPage(reply, pages.adminDashboard);
  });

  app.get('/admin/lists', { preHandler: requireRole() }, async (request, reply) => {
    sendPage(reply, pages.adminLists);
  });

  // Read-only views: any logged-in admin may look, only operators may change.
  app.get('/admin/api/employees', { preHandler: requireRole() }, async (request, reply) => {
    const employees = await listEmployees();
    return { count: employees.length, employees };
  });

  app.post(
    '/admin/api/employees/import',
    {
      onRequest: app.csrfProtection,
      preHandler: requireRole('raffle_operator', 'vote_operator'),
    },
    async (request, reply) => {
      const csvText = typeof request.body === 'string' ? request.body : '';
      if (!csvText.trim()) {
        reply.code(400);
        return { message: 'Request body must be CSV text with header emp_id,name,dept,nic' };
      }

      const { valid, errors: parseErrors } = parseEmployeeCsv(csvText);
      const { imported, errors: importErrors } = await importEmployees(valid);

      await logEvent({
        module: 'core',
        event: 'employees_import',
        ip: request.ip,
        detail: { by: request.adminSession.username, imported, errorCount: parseErrors.length + importErrors.length },
      });

      return {
        imported,
        errors: [...parseErrors, ...importErrors],
      };
    }
  );

  app.get('/admin/api/audit/export', { preHandler: requireRole('auditor') }, async (request, reply) => {
    const csv = await exportAuditCsv();
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="audit_log.csv"')
      .send(csv);
  });

  app.post(
    '/admin/api/system/clear',
    {
      onRequest: app.csrfProtection,
      preHandler: requireRole(),
      schema: clearDatabaseSchema,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const result = await systemService.clearDatabase({
        password: request.body.password,
        username: request.adminSession.username,
        ip: request.ip,
        by: request.adminSession.username,
      });
      if (!result.ok) reply.code(400);
      return result;
    }
  );
}
