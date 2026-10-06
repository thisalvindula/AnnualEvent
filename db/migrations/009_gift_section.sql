-- Where a gift appears on the raffle screen's draw layout: 'podium' (a single
-- winner shown big, lowest draw order at the top) or 'consolation' (the row
-- along the bottom). Existing single-winner gifts become podium gifts.
ALTER TABLE raffle_gifts
  ADD COLUMN section text NOT NULL DEFAULT 'consolation'
  CHECK (section IN ('podium', 'consolation'));
UPDATE raffle_gifts SET section = 'podium' WHERE quantity = 1;
ALTER TABLE raffle_gifts
  ADD CONSTRAINT raffle_gifts_podium_single CHECK (section <> 'podium' OR quantity = 1);
