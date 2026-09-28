-- VOTING module tables. Never referenced by the raffle migration or module code.

CREATE TABLE vote_config (
  id        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  opens_at  timestamptz,
  closes_at timestamptz,
  duration_minutes int NOT NULL DEFAULT 15,
  status    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed'))
);

CREATE TABLE vote_finalists (
  id       serial PRIMARY KEY,
  name     text NOT NULL,
  song     text,
  position int NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 5)
);

CREATE TABLE vote_votes (
  emp_id      text PRIMARY KEY REFERENCES employees(emp_id),      -- one vote per person, first is final
  finalist_id int NOT NULL REFERENCES vote_finalists(id),
  voted_at    timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  user_agent  text
);

INSERT INTO vote_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- vote_config: admin config/start/close routes update the single row.
GRANT SELECT, INSERT, UPDATE ON vote_config TO app_runtime;

-- vote_finalists: editable by admin only before voting starts (enforced in app logic),
-- so the app needs full DML here including delete/replace of the finalist list.
GRANT SELECT, INSERT, UPDATE, DELETE ON vote_finalists TO app_runtime;

-- vote_votes: insert-only from the app's perspective (ON CONFLICT DO NOTHING pattern);
-- the first vote is final, so the app never updates or deletes a cast vote.
GRANT SELECT, INSERT ON vote_votes TO app_runtime;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
