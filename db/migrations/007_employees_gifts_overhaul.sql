-- Employees: drop the department column, add an explicit photo file name.
-- Gifts: replace the fixed 25-gift/tier model with an admin-editable list of
-- "places" (id, place label, quantity of winners, description).
--
-- Existing rows are converted rather than dropped: each old gift becomes a
-- quantity-1 gift whose id is its old draw position (seq), and each old draw
-- result becomes slot 1 of that gift.

-- ---- employees ------------------------------------------------------------

ALTER TABLE employees ADD COLUMN image_name text;
-- Photos used to be looked up as "<emp_id>.jpg"; keep existing employees
-- pointing at the same files. Admins can change this per employee afterwards.
UPDATE employees SET image_name = emp_id || '.jpg';
ALTER TABLE employees DROP COLUMN dept;

-- ---- raffle gifts + draw results -------------------------------------------

ALTER TABLE raffle_draw_results DROP CONSTRAINT raffle_draw_results_seq_fkey;
ALTER TABLE raffle_draw_results DROP CONSTRAINT raffle_draw_results_pkey;
ALTER TABLE raffle_draw_results RENAME COLUMN seq TO gift_id;
ALTER TABLE raffle_draw_results ADD COLUMN slot int NOT NULL DEFAULT 1 CHECK (slot >= 1);
ALTER TABLE raffle_draw_results ALTER COLUMN slot DROP DEFAULT;
-- (gift_id, slot) is the backstop against a double "draw next" race filling
-- the same winner slot twice; emp_id UNIQUE still stops anyone winning twice.
ALTER TABLE raffle_draw_results ADD PRIMARY KEY (gift_id, slot);

ALTER TABLE raffle_gifts DROP COLUMN id;                       -- also drops the old serial PK
ALTER TABLE raffle_gifts DROP CONSTRAINT raffle_gifts_seq_key;
ALTER TABLE raffle_gifts RENAME COLUMN seq TO id;              -- admin-chosen id; draw order is ascending id
ALTER TABLE raffle_gifts ADD PRIMARY KEY (id);
ALTER TABLE raffle_gifts RENAME COLUMN name TO description;
ALTER TABLE raffle_gifts ADD COLUMN place text;
UPDATE raffle_gifts SET place = CASE tier WHEN 'premium' THEN 'Grand Prize' ELSE 'Prize' END;
ALTER TABLE raffle_gifts ALTER COLUMN place SET NOT NULL;
ALTER TABLE raffle_gifts ADD COLUMN quantity int NOT NULL DEFAULT 1 CHECK (quantity >= 1);
ALTER TABLE raffle_gifts DROP COLUMN tier;

ALTER TABLE raffle_draw_results
  ADD CONSTRAINT raffle_draw_results_gift_id_fkey
  FOREIGN KEY (gift_id) REFERENCES raffle_gifts(id) ON UPDATE CASCADE;

-- Gifts are now edited in place (INSERT/UPDATE/DELETE); deleting a gift that
-- already has winners is blocked by the foreign key above.
GRANT SELECT, INSERT, UPDATE, DELETE ON raffle_gifts TO app_runtime;
