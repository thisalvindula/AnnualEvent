-- Grants for the password-gated "reset & reopen fresh" admin action.
--
-- raffle_registrations, raffle_draw_results and vote_votes were originally
-- insert-only (no DELETE grant) so a compromised or buggy app process could
-- never erase entries/votes. Operators now have an explicit reset action
-- (app/modules/raffle/service.js reset(), app/modules/voting/service.js
-- reset()) that re-verifies the logged-in operator's own password before
-- wiping these tables, so the DELETE grant is safe: nothing in the app can
-- reach it without that extra confirmation, and every reset is audit-logged.
GRANT DELETE ON raffle_registrations TO app_runtime;
GRANT DELETE ON raffle_draw_results TO app_runtime;
GRANT DELETE ON vote_votes TO app_runtime;
