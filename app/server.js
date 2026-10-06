import { config } from './core/config.js';
import { pool } from './core/db.js';
import { closeAll } from './core/sse-hub.js';
import { buildApp } from './buildApp.js';

const app = await buildApp();

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.warn(`${signal} received, starting graceful shutdown`);

  closeAll(); // notify + end all open screen connections first, so they reconnect promptly

  const forceExit = setTimeout(() => {
    app.log.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 12000); // stays under docker-compose.yml's stop_grace_period (15s)
  forceExit.unref();

  try {
    await app.close(); // stop accepting new connections, drain in-flight requests
    await pool.end(); // close the pg pool cleanly
    app.log.info('shutdown complete');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A stray rejection anywhere is logged, not fatal: every route handler is
// already awaited by Fastify, so a rejection there becomes a normal error
// response (see buildApp.js's setErrorHandler), not an unhandled one — this
// only catches something unforeseen deep in a dependency. Staying up through
// it is worth more, for a live event, than the process exiting on principle.
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandledRejection');
});

// An uncaught exception means the process may be in an inconsistent state —
// unlike unhandledRejection, we don't keep serving through this. Attempt the
// same graceful shutdown as SIGTERM, then exit; restart: unless-stopped
// brings a fresh process back up within seconds.
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaughtException — starting controlled shutdown');
  shutdown('uncaughtException').finally(() => process.exit(1));
});

app
  .listen({ host: '0.0.0.0', port: config.port })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
