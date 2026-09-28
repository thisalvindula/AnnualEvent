import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import csrfProtection from '@fastify/csrf-protection';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './core/config.js';
import { pool } from './core/db.js';
import { registerSessionDecorator } from './core/auth/middleware.js';
import { registerCoreRoutes } from './core/routes.js';
import { registerRaffleRoutes } from './modules/raffle/routes.js';
import { registerRaffleAdminRoutes } from './modules/raffle/admin.js';
import { registerVotingRoutes } from './modules/voting/routes.js';
import { registerVotingAdminRoutes } from './modules/voting/admin.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: true,
  trustProxy: config.trustProxy,
});

await app.register(helmet);
await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: config.rateLimitAllowlist });
await app.register(cookie, { secret: config.sessionSecret });
// cookieOpts replaces the plugin's defaults wholesale, so path must be set
// explicitly — otherwise the cookie is scoped to /admin/api/ and never sent
// with POST /admin/login or /admin/logout. cookieKey is renamed from the
// default "_csrf" so browsers holding the old /admin/api/-scoped cookie don't
// keep reusing that secret (the plugin only sets a new cookie if none exists).
await app.register(csrfProtection, {
  cookieKey: '_csrf_secret',
  cookieOpts: { path: '/', httpOnly: true, secure: true, signed: true, sameSite: 'lax' },
});
// Hashed, content-addressed JS/CSS chunks built by Vite — safe to cache
// long-term since a new build always produces new filenames. The HTML
// shells that reference them (served per-route below, via builtPages.js)
// are sent with Cache-Control: no-cache instead, so deploys roll out cleanly.
await app.register(fastifyStatic, {
  root: path.join(dirname, '../frontend/dist/assets'),
  prefix: '/assets/',
  decorateReply: false,
  maxAge: '1y',
  immutable: true,
});
// Employee photos baked into the image at build time (see Dockerfile),
// named "<emp_id>.jpg"/"<emp_id>.png" — not an upload/volume, just static
// files shipped alongside app/ and db/.
await app.register(fastifyStatic, {
  root: path.join(dirname, '../employee-photos'),
  prefix: '/employee-photos/',
  decorateReply: false,
});

app.addContentTypeParser('text/csv', { parseAs: 'string' }, (request, body, done) => {
  done(null, body);
});

registerSessionDecorator(app);

app.get('/', async (request, reply) => {
  reply.type('text/html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Annual Event</title>
  <style>
    body {
      background: #eef1f6;
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f1a2b;
    }
    .landing { text-align: center; padding: 2.5rem; }
    .landing .brand { display: flex; align-items: center; justify-content: center; gap: 0.6rem; margin-bottom: 1.5rem; }
    .landing .mark {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: linear-gradient(135deg, #17335e, #060b18);
    }
    .landing .name { font-weight: 700; letter-spacing: 0.01em; font-size: 0.95rem; }
    .landing p { color: #5b6577; font-size: 1rem; }
  </style>
</head>
<body>
  <div class="landing">
    <div class="brand"><span class="mark"></span><span class="name">Annual Event</span></div>
    <p>Nothing is open right now.</p>
  </div>
</body>
</html>`);
});

app.get('/api/health', async (request, reply) => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', db: 'ok' };
  } catch (err) {
    request.log.error(err, 'health check db failure');
    reply.code(503);
    return { status: 'degraded', db: 'error' };
  }
});

await registerCoreRoutes(app);
await registerRaffleRoutes(app);
await registerRaffleAdminRoutes(app);
await registerVotingRoutes(app);
await registerVotingAdminRoutes(app);

app
  .listen({ host: '0.0.0.0', port: config.port })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
