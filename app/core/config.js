import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  trustProxy: process.env.TRUST_PROXY === 'true',

  // Fixed public address of the app. The printed QR codes encode this, so it
  // must not depend on the address a screen happens to be opened at.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, ''),

  databaseUrl: required('DATABASE_URL'),
  dbPoolMin: Number(process.env.DB_POOL_MIN ?? 2),
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 20),

  sessionSecret: required('SESSION_SECRET'),
  nicPepper: required('NIC_PEPPER'),

  screenTokens: {
    raffle: required('SCREEN_TOKEN_RAFFLE'),
    vote: required('SCREEN_TOKEN_VOTE'),
  },
  screenAllowedIps: (process.env.SCREEN_ALLOWED_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // IPs exempt from the global rate limiter. Empty by default; set this to
  // the load-testing machine's IP only for the duration of a k6 run
  // (requirement 12: "Rate limiting ... will block a single-IP test.").
  rateLimitAllowlist: (process.env.RATE_LIMIT_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
