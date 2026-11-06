-- 037_add_council_number.sql
--
-- Councils are named by their number, as LGUs do: "12th Sangguniang Bayan",
-- with the term (2025-2028) shown under it. The number is entered by the
-- Secretary/Clerk in Add/Edit Council rather than counted from the councils
-- in the system, because older councils were never entered, so counting
-- would give the wrong number.
--
-- Nullable: existing councils show their term as the title until a number
-- is set. Unique, so two councils can't both be "12th".
--
-- Run before restarting the backend on this code — Add/Edit Council saves
-- the new column.

BEGIN;

ALTER TABLE councils
  ADD COLUMN IF NOT EXISTS council_number integer
    CHECK (council_number BETWEEN 1 AND 999);

CREATE UNIQUE INDEX IF NOT EXISTS councils_council_number_unique
  ON councils (council_number) WHERE council_number IS NOT NULL;

COMMIT;
