# Database migrations

Plain, numbered SQL files — no migration framework, no magic. This project's
schema previously lived only in the Supabase dashboard with nothing in git,
so past changes aren't reviewable or reproducible. This folder fixes that
going forward.

## Convention

- `NNN_short_description.sql`, zero-padded, one more than the highest number
  currently in the folder (`001_...`, `002_...`, ...).
- Each file is idempotent where practical (`IF NOT EXISTS`, `ON CONFLICT DO
  NOTHING`) so re-running an already-applied file is a safe no-op rather than
  an error.
- Each file wraps its DDL + backfill in a single `BEGIN`/`COMMIT` transaction,
  so a failure partway through leaves the schema untouched rather than
  half-migrated.
- Files are never edited after being applied to any real environment — a
  correction ships as a new numbered file, the same rule every real migration
  tool enforces.

## Applying a migration

There's no CLI wired up yet — for now, open the file, paste its contents into
the Supabase project's SQL Editor, and run it. Read the comments at the top
of each file first; several of these encode a real business rule, not just a
column add, and are worth understanding before running against a database
with real data in it.

## Applied so far

| # | File | Summary |
|---|------|---------|
| 001 | `001_create_councils_table.sql` | Adds `councils` as a first-class entity; backfills one row per distinct (normalized) `term_period` already in use. |
| 002 | `002_add_council_id_and_position_to_terms.sql` | Adds `council_id` (FK) and `position` to `sb_council_member_terms`; backfills both from existing data. |
| 003 | `003_relax_sb_council_members_position_not_null.sql` | Drops the (now-obsolete) NOT NULL constraint on `sb_council_members.position`, since the app no longer writes it on new member rows. |
| 004 | `004_add_term_id_to_ordinance_and_resolution_officials.sql` | Adds `term_id` (FK to `sb_council_member_terms`) to `ordinance_officials`/`resolution_officials`; backfills using `COALESCE(reviewed_at, uploaded_at)` as the point-in-time to find each official's best-guess membership. |
| 005 | `005_unique_active_singular_position_per_council.sql` | Partial unique index: at most one active Vice Mayor / Liga President / SK Federated President per council. Will fail if existing data already conflicts — see the diagnostic query in the file. |
| 006 | `006_drop_sb_council_members_position.sql` | Drops the now-unused legacy `position` column from `sb_council_members` — every read was moved to compute position from the member's terms instead. |
| 007 | `007_archives_table_and_atomic_restore.sql` | Codifies the `archives` table (previously undocumented, created ad hoc in the dashboard) and adds `archive_ordinance`/`archive_resolution`/`archive_session_minutes`/`restore_archive` Postgres functions so the archive/restore sequences run as a single transaction instead of several sequential Supabase JS calls. |
| 008 | `008_archives_pagination_search_rpc.sql` | Adds `get_archives()`, a Postgres function that unions/filters/paginates the three archive sources (content snapshots, archived users, archived officials) in one query, so `GET /api/archives` can support search + LIMIT/OFFSET without loading the whole archive set into memory. |
| 009 | `009_archives_sort_direction.sql` | Adds a `p_sort` ('asc'/'desc') parameter to `get_archives()` so the Archives page's "Archived" column header can toggle sort order server-side (sorting only the current page client-side would be misleading under pagination). **Left a stale overload behind — see 010.** |
| 010 | `010_fix_get_archives_overload.sql` | Fixes 009: `CREATE OR REPLACE FUNCTION` can't change a function's argument count, so 009 created a second overloaded `get_archives` instead of replacing the first, and PostgREST couldn't disambiguate calls (breaking the endpoint entirely, not just sorting). Drops the stale 4-parameter overload. |
| 011 | `011_case_insensitive_username_email_uniqueness.sql` | Adds case-insensitive unique indexes on `users.username`/`users.email` (on top of the existing case-sensitive constraint) so e.g. "JDoe" and "jdoe" can't both exist. Verified no case-variant duplicates existed before writing this. |
| 012 | `012_add_must_change_password.sql` | Adds `users.must_change_password` (default false), backing the admin-initiated "reset this user's password" flow — set true when an admin forces a temp password, cleared automatically on the user's next successful password change. |
| 015 | `015_add_notifications.sql` | Adds `users.email_notifications` (default true), `created_by` (FK) on `ordinances`/`resolutions`/`session_minutes`, and the `notifications` table backing the two-channel (email + in-app) notification workflow — see `helpers/notify.js`. |
| 016 | `016_add_calendar_reminder_sent.sql` | Adds `calendar_events.reminder_sent` (default false), so the daily 8am reminder job (`helpers/reminderJob.js`) doesn't re-notify the same event twice. |
| 017 | `017_drop_notifications_table.sql` | Drops the `notifications` table added in 015 — the workflow moved to email-only, so there's no in-app bell/list backing it anymore. `users.email_notifications` and `calendar_events.reminder_sent` stay. |
| 018 | `018_create_session_agendas_table.sql` | Adds `session_agendas` (session_number, session_date, session_type, venue, filename/filetype/filepath, created_by) for the new Session Agenda module — Secretary/Clerk upload a PDF or Word agenda for an upcoming session. Unlike ordinances/resolutions/session_minutes, there's no status/review-workflow column: an upload is immediately live, and deletes are a plain hard delete rather than going through the `archives` table. |
| 019 | `019_add_reading_stage_to_ordinances_and_resolutions.sql` | Adds `reading_stage` (nullable, CHECK'd to `first_reading`/`second_reading`/`third_reading`) to `ordinances`/`resolutions`, tracking the three readings a draft goes through before Secretary may Accept it. **Superseded by 020** — the three readings turned out to fit more simply as `status` values than as a second parallel column. |
| 020 | `020_drop_reading_stage_from_ordinances_and_resolutions.sql` | Reverts 019. The three readings are now three more `status` values (`first_reading`/`second_reading`/`third_reading`) inserted between "Secretary accepted" and "ready for Vice-Mayor" — see `helpers/legislativeReviewRoutes.js`'s `/accept` and `/advance-reading`. No schema change needed for that part: `status` is plain text with no CHECK constraint. |
| 021 | `021_add_role_to_ordinance_and_resolution_officials.sql` | Adds `role` (`author`/`co_author`/`sponsor`, default `author`) to `ordinance_officials`/`resolution_officials`, plus a unique index per (record, official, role) — Co-Author and Sponsor are new roles addable once a draft reaches a reading stage, see `helpers/officialRoleRoutes.js`. |
| 022 | `022_add_password_reset_token.sql` | Adds `reset_token`/`reset_token_expires` to `users`, backing a real "reset password" email link — replaces the old admin-forced temp-password flow (see `must_change_password` in 012) with a time-limited link the account uses to set their own new password directly. See `POST /:id/reset-password` (routes/users.js) and `GET`/`POST /api/reset-password/:token` (routes/auth.js). |
| 023 | `023_relax_content_posts_body_not_null.sql` | Drops the NOT NULL constraint on `content_posts.body` — the Content Management "New Post" form only requires Title (Caption has always been optional in the UI), so a photo-only post with no caption text should be allowed. Paired with relaxing the matching `if (!title \|\| !body)` check in `routes/contentPosts.js`. |
| 024 | `024_add_liga_and_sk_federated_positions.sql` | Replaces the `users_position_check` CHECK constraint to also allow `liga_ng_mga_barangay`/`sk_federated` as role:`user` positions — both ex-officio SB members, treated identically to Councilor everywhere in the backend's RBAC (see `ROLE_POSITIONS` in `helpers/roles.js`). |
| 025 | `025_add_publish_on_to_ordinances_and_resolutions.sql` | Adds `publish_on` (timestamptz) to `ordinances`/`resolutions`, stamped by `PUT /:id/publish`, so a published record is dated by when it was published instead of when the draft was uploaded (`uploaded_at`, unchanged). **Superseded by 026** — the date the office wants is approval, not publishing. Backfills existing published rows from the matching `PUBLISH` activity-log entry, else `reviewed_at`, else `uploaded_at` — best-effort for old records. |
| 026 | `026_add_approved_on_to_ordinances_and_resolutions.sql` | Adds `approved_on` (timestamptz) to `ordinances`/`resolutions`, stamped by `PUT /:id/vm-approve`, so a finished record is dated by when the Vice-Mayor approved it (labelled "Approved" in the UI). Backfills already approved/published rows from `reviewed_at`, which nothing writes after the approval. 025's `publish_on` is left in place, unused, and can be dropped later. |
| 027 | `027_drop_publish_on_from_ordinances_and_resolutions.sql` | Drops 025's now-unused `publish_on` (replaced by 026's `approved_on`). Run after the backend has been restarted on the current code. |
| 028 | `028_allow_all_review_statuses_on_ordinances_and_resolutions.sql` | Replaces the dashboard-made `resolutions_status_check` (which rejected `first_reading` and so broke Accept on resolutions) with a CHECK allowing every status the review workflow uses. Resolutions only — ordinances already work through every reading stage. |
| 029 | `029_add_filepath_to_session_minutes.sql` | Adds `session_minutes.filepath`, so an uploaded session-minutes file is kept and the View window can open the PDF / download the Word file, like ordinances and resolutions. The backend works without it (files just aren't kept) until it's applied. |
| 030 | `030_archive_order_of_business.sql` | Order of business is archived instead of hard-deleted: adds `archive_session_agenda()`, teaches `restore_archive()` the `session_agenda` type, and gives `get_archives()` a title for it. **Run before restarting the backend on this code** — Archive on Order of Business calls the new function. |
| 031 | `031_account_links_and_author_approvals.sql` | Author approval workflow (panel recommendation). Adds `sb_council_members.user_id` (unique, nullable FK to `users`) linking a council member to their login account; the `author_approvals` table (one row per record + stage: `first_reading`/`second_reading`/`third_reading`/`publish`, decision `pending`/`approved`/`declined`, `on_behalf` for approvals the Secretary records for an author with no account); and `author_approval_required` on `ordinances`/`resolutions`, set by Accept, so records already mid-reading finish under the old rules. **Run before restarting the backend on this code.** |
| 032 | `032_council_member_display_order.sql` | Adds `sb_council_member_terms.display_order` (per-council official order, set by dragging cards in Councilor Management; NULL = not placed yet, sorted last). Backfills each council: Vice Mayor, Councilors, Liga President, SK Federated President. |
| 033 | `033_author_approval_on_accept.sql` | Adds the `accepted` step between Pending and First Reading: Accept moves a draft to `accepted` and requests the author's approval (new `author_approvals` stage `accepted`); after it's approved the Secretary clicks "Proceed to First Reading". Adds `accepted` to `resolutions_status_check` (and `ordinances_status_check` if one exists) and to `author_approvals`' stage CHECK. **Run before restarting the backend on this code** — Accept fails on resolutions until it's applied. |
| 034 | `034_record_history.sql` | Adds the append-only `record_history` table (one row per event, never overwritten): the full trail of an ordinance/resolution from upload to publish/reject, including each author decline with its date and comment. Shown in the record's details to staff only (`GET /:id/history`). Backfills existing records with what can be rebuilt (upload, latest author decision per stage, VM approval, rejection + reason). **Run before restarting the backend on this code** — until then history writes just log an error and the History panel shows a load error. |
| 035 | `035_record_history_from_activity_logs.sql` | Fills in older records' `record_history` from `activity_logs` (matched on "...: <title>", like 025): Accept, each reading / Send for VM Approval, author approval requests, every author decline (including ones a re-request overwrote — date only, their comment was never kept), Request Changes (reason from the comment thread), and Publish. Only imports logs from before live history recording started; runs once. |
| 036 | `036_add_tour_completed.sql` | Adds `users.tour_completed` (default `false`): whether the account has finished or skipped the dashboard's guided tour, so it only auto-starts once. Existing accounts see it once on their next login. **Run before restarting the backend on this code** — login reads the column. |

Also required once, outside the numbered files (a raw `CREATE TABLE` in the
SQL Editor doesn't inherit the grants Supabase's Table Editor UI applies
automatically): after running 001, if querying `councils` comes back with
`permission denied for table councils` even via the service-role key, run:
```sql
GRANT ALL ON councils TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE councils_id_seq TO postgres, anon, authenticated, service_role;
```
