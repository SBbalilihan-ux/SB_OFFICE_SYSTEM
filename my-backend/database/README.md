# Database setup (new client / new environment)

| File | What it does |
|------|--------------|
| `schema.sql` | Creates the whole database (22 tables, indexes, rules, archive functions, storage bucket) on an **empty** Supabase project. |
| `seed_first_admin.sql` | Creates the first Secretary login so someone can sign in. |

## Steps

1. Create a new Supabase project.
2. SQL Editor → paste `schema.sql` → Run.
3. Edit the name / username / email / password in `seed_first_admin.sql` → Run.
4. Put the new project's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
   backend's `.env`, then start the backend.
5. Log in with the seeded account; the app asks for a new password.

Both files are safe to run twice.

## How this relates to `migrations/`

- `schema.sql` = the result of every migration (001–036) plus the tables that
  were first made by hand in the Supabase dashboard. **Don't run the numbered
  migrations on a database built from `schema.sql`.**
- `migrations/` = the step-by-step change history for the existing production
  database.

**When you add a migration, update `schema.sql` too** (edit the table or
function in place), so new installs always match production.

## Differences from the original production database

- Row Level Security is on for every table with no policies. The backend uses
  the service-role key, which bypasses RLS, so nothing changes for the app;
  the public anon key just can't read the tables directly.
- Deleting an announcement also deletes its reads and reactions
  (`ON DELETE CASCADE`).
- Deleting a council-member term clears `term_id` on author credits instead of
  failing (`ON DELETE SET NULL`).
- `ordinances.status` has the same allowed-values rule as `resolutions.status`.
- Left out because the app doesn't use them: the `notifications` and
  `reactions` tables and the `auto_end_terms()` function.
