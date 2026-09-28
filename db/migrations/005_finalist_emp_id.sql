-- Optional link to a real employee record, so the screen can show a photo
-- (filename = emp_id) next to a finalist and on the winner reveal. Nullable:
-- finalists without a match just fall back to an initials avatar.
ALTER TABLE vote_finalists ADD COLUMN emp_id text REFERENCES employees(emp_id);
