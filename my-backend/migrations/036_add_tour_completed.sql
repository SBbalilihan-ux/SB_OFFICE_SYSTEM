-- 036_add_tour_completed.sql
--
-- Backs the dashboard's guided tour (ProductTour.js in my-app). The tour
-- starts automatically on an account's first visit to the dashboard; this
-- flag records that it was finished or skipped so it doesn't start again —
-- stored on the account (not the browser) so it also stays dismissed on a
-- different computer. Set by PUT /api/users/me/tour-completed; the "?" help
-- button can still replay it any time.
--
-- Existing accounts get `false` too, so everyone sees the tour once on
-- their next login after this ships.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tour_completed boolean NOT NULL DEFAULT false;

COMMIT;
