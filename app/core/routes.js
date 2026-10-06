import { logEvent, exportAuditCsv } from './audit/index.js';
import { findAdminByUsername } from './auth/repo.js';
import { verifyPassword } from './auth/passwords.js';
import { issueSession, clearSession } from './auth/session.js';
import { requireRole } from './auth/middleware.js';
import { pages, sendPage } from './builtPages.js';
import {
  parseEmployeeCsv,
  importEmployees,
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
} from './employees/index.js';
import * as systemService from './system/service.js';
import { config } from './config.js';

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

const EMPLOYEE_EDITORS = ['raffle_operator', 'vote_operator'];

const createEmployeeSchema = {
  body: {
    type: 'object',
    required: ['empId', 'name', 'nic'],
    additionalProperties: false,
    properties: {
      empId: { type: 'string', minLength: 1, maxLength: 64 },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      nic: { type: 'string', minLength: 1, maxLength: 20 },
      imageName: { type: ['string', 'null'], maxLength: 200 },
    },
  },
};

const updateEmployeeSchema = {
  params: {
    type: 'object',
    properties: { empId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      nic: { type: 'string', maxLength: 20 },
      imageName: { type: ['string', 'null'], maxLength: 200 },
    },
  },
};

function employeeResultStatus(result) {
  if (result.ok) return 200;
  if (result.reason === 'not_found') return 404;
  if (result.reason === 'exists' || result.reason === 'in_use') return 409;
  return 400;
}

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

  // Public, non-secret: the fixed base URL the event QR codes encode.
  app.get('/api/public-config', async () => ({ publicBaseUrl: config.publicBaseUrl || null }));

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
      preHandler: requireRole(...EMPLOYEE_EDITORS),
    },
    async (request, reply) => {
      const csvText = typeof request.body === 'string' ? request.body : '';
      if (!csvText.trim()) {
        reply.code(400);
        return { message: 'Request body must be CSV text with header emp_id,name,nic,image_name' };
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

  app.post(
    '/admin/api/employees',
    { onRequest: app.csrfProtection, preHandler: requireRole(...EMPLOYEE_EDITORS), schema: createEmployeeSchema },
    async (request, reply) => {
      const result = await createEmployee({
        ...request.body,
        ip: request.ip,
        by: request.adminSession.username,
      });
      reply.code(result.ok ? 201 : employeeResultStatus(result));
      return result;
    }
  );

  app.put(
    '/admin/api/employees/:empId',
    { onRequest: app.csrfProtection, preHandler: requireRole(...EMPLOYEE_EDITORS), schema: updateEmployeeSchema },
    async (request, reply) => {
      const result = await updateEmployee(request.params.empId, {
        ...request.body,
        ip: request.ip,
        by: request.adminSession.username,
      });
      reply.code(employeeResultStatus(result));
      return result;
    }
  );

  app.delete(
    '/admin/api/employees/:empId',
    { onRequest: app.csrfProtection, preHandler: requireRole(...EMPLOYEE_EDITORS) },
    async (request, reply) => {
      const result = await deleteEmployee(request.params.empId, {
        ip: request.ip,
        by: request.adminSession.username,
      });
      reply.code(employeeResultStatus(result));
      return result;
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
