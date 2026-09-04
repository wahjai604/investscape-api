-- Migration 0011. Applied 2026-09-04, same day as 0008/0009/0010.
--
-- Closes a gap found by "RLS Verification (2026-09-04).md"
-- (C:\Users\Eric\Dropbox\Personal\00 Projects\Investscape Phase 2
-- (WeWeb+Supabase)\RLS Verification (2026-09-04).md), section
-- "Results — translations (shared dictionary)":
--
--   "Both roles read it; neither can write it. As designed in 0010. Same
--    caveat as above: writes are denied by the missing GRANT, not by a
--    policy — there is only a FOR SELECT USING (true) policy on this table.
--    If a write grant were ever added, there is no restrictive policy
--    behind it to catch the mistake."
--
-- investscape.translations currently has exactly one policy
-- (translations_select_all, FOR SELECT USING (true), from 0010) and is
-- protected from writes purely by 0010's `REVOKE ALL ... FROM anon,
-- authenticated` / `GRANT SELECT ... TO anon, authenticated`. That is a
-- single point of failure: if any future migration ever adds an INSERT/
-- UPDATE/DELETE grant on this table to anon or authenticated — even by
-- accident, even scoped to one column — there is currently nothing at the
-- policy layer to stop the write. Defense in depth means the RLS layer
-- should independently refuse writes too, so a grant mistake doesn't
-- silently become a real vulnerability.
--
-- This migration adds three explicit RESTRICTIVE policies that
-- categorically deny INSERT/UPDATE/DELETE to every role. Restrictive
-- policies are AND'd with the permissive set for their command, and Postgres
-- evaluates permissive/restrictive policies per-command (FOR INSERT/UPDATE/
-- DELETE here) — so these have zero interaction with the existing permissive
-- SELECT policy; reads are untouched. There is no admin-role concept in this
-- schema yet, so "deny to every role" is intentional: population continues
-- to happen exclusively via the direct service-role/`postgres` connection
-- (see i18n-export/import-to-supabase.js), which — as table owner — bypasses
-- RLS entirely by default in Postgres, confirmed empirically below rather
-- than assumed:
--
--   The import script authenticates as the `postgres` role over the same
--   DATABASE_URL this repo's migrations use. `postgres` owns every table
--   created by these migrations (CREATE TABLE runs as the connecting role),
--   and Postgres exempts a table's owner from RLS unless
--   `FORCE ROW LEVEL SECURITY` has been set — 0010 never set it (confirmed:
--   `relforcerowsecurity` is false on investscape.translations, per the RLS
--   Verification note's own environment-fact table), and this migration
--   does not set it either. So the restrictive policies below apply to
--   `anon`/`authenticated` (and any future non-owner role) and have no
--   effect on the owner-role import path.
ALTER TABLE investscape.translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY translations_deny_insert ON investscape.translations
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY translations_deny_update ON investscape.translations
  AS RESTRICTIVE
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY translations_deny_delete ON investscape.translations
  AS RESTRICTIVE
  FOR DELETE
  USING (false);
