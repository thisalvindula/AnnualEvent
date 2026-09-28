-- CORE: employees, admin users, audit log, and the restricted runtime DB role.
--
-- This migration runs as the schema-owning role (POSTGRES_USER / MIGRATION_DATABASE_URL).
-- It creates app_runtime, the least-privilege role the running app connects as
-- (DATABASE_URL). app_runtime must never be granted UPDATE/DELETE on audit_log,
-- so a compromised or buggy app process cannot alter or erase history.

CREATE TABLE employees (
  emp_id         text PRIMARY KEY,
  name           text NOT NULL,
  dept           text,
  nic_last4_hash text NOT NULL          -- salted/peppered hash, never plain text
);

CREATE TABLE admin_users (
  id            serial PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,          -- argon2
  role          text NOT NULL CHECK (role IN ('raffle_operator','vote_operator','auditor'))
);

CREATE TABLE audit_log (
  id     bigserial PRIMARY KEY,
  ts     timestamptz NOT NULL DEFAULT now(),
  module text,                           -- 'raffle' | 'voting' | 'core'
  event  text NOT NULL,
  emp_id text,
  ip     inet,
  detail jsonb
);

-- Restricted runtime role used by the app at request time.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN PASSWORD '__APP_DB_PASSWORD__';
  ELSE
    ALTER ROLE app_runtime WITH LOGIN PASSWORD '__APP_DB_PASSWORD__';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;

-- Any table created later by the owner role (in 002_raffle.sql, 003_voting.sql, ...)
-- automatically gets these same baseline grants for app_runtime.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- employees: the import route inserts/updates rows; verify routes only read.
GRANT SELECT, INSERT, UPDATE ON employees TO app_runtime;

-- admin_users: accounts are provisioned out of band (migration/seed); the app only
-- needs to read them to check logins.
GRANT SELECT ON admin_users TO app_runtime;

-- audit_log: append-only. INSERT + SELECT only, deliberately no UPDATE or DELETE.
GRANT SELECT, INSERT ON audit_log TO app_runtime;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
