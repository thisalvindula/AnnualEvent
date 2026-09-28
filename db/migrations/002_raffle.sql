-- RAFFLE module tables. Never referenced by the voting migration or module code.

CREATE TABLE raffle_config (
  id        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  opens_at  timestamptz,
  closes_at timestamptz,
  status    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed'))
);

CREATE TABLE raffle_gifts (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  tier  text NOT NULL CHECK (tier IN ('normal','premium')),
  seq   int UNIQUE NOT NULL              -- draw order: normal gifts first, premium last
);

CREATE TABLE raffle_registrations (
  emp_id        text PRIMARY KEY REFERENCES employees(emp_id),   -- one entry per person
  ticket_no     serial UNIQUE,
  registered_at timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text
);

CREATE TABLE raffle_draw_results (
  seq          int PRIMARY KEY REFERENCES raffle_gifts(seq),
  emp_id       text UNIQUE NOT NULL REFERENCES raffle_registrations(emp_id),  -- wins once
  drawn_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO raffle_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- raffle_config: admin config/open/close routes update the single row.
GRANT SELECT, INSERT, UPDATE ON raffle_config TO app_runtime;

-- raffle_gifts: admin sets (and can replace, before the draw starts) the gift list.
GRANT SELECT, INSERT, DELETE ON raffle_gifts TO app_runtime;

-- raffle_registrations / raffle_draw_results: insert-only from the app's perspective
-- (ON CONFLICT DO NOTHING patterns); never updated, never deleted.
GRANT SELECT, INSERT ON raffle_registrations TO app_runtime;
GRANT SELECT, INSERT ON raffle_draw_results TO app_runtime;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
