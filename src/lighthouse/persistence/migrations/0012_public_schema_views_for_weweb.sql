-- Migration 0012. Applied 2026-09-05.
--
-- WeWeb's Supabase data-source plugin only lists tables from the `public`
-- schema when populating its "select a table" dropdown, regardless of what
-- is on Supabase's own Data API "Exposed schemas" allow-list. All five of
-- InvestScape's real tables live in the `investscape` schema (deliberately
-- separate from `public`, see 0008's header). Without something in `public`,
-- WeWeb shows "No options available" and cannot bind a collection at all —
-- confirmed live in this session's WeWeb editor, and a known, documented
-- limitation (WeWeb community: "Connecting to Supabase PostgreSQL schema
-- other than public"), not something specific to this project.
--
-- Fix: thin pass-through views in `public`, one per investscape table.
--
-- CRITICAL SECURITY DETAIL — read before ever adding another one of these:
-- a plain `CREATE VIEW` in Postgres defaults to running with the VIEW
-- OWNER's privileges when reading the underlying table, not the querying
-- role's. Since these tables are owned by the migration-running role
-- (which is exempt from its own tables' RLS by default, same as any table
-- owner), a naive view here would make EVERY row of EVERY user's data
-- visible through the view regardless of RLS on the base table — a total,
-- silent RLS bypass, not a partial one. This is a well-known Postgres/
-- Supabase gotcha, not a hypothetical.
--
-- The fix, available since Postgres 15 (confirmed running here: PG 17.6):
-- `WITH (security_invoker = true)` on every view below. This makes the view
-- evaluate table access — including RLS — as the ACTUAL QUERYING ROLE, not
-- the view owner. Every view here uses it. Do not create a public-schema
-- view over any investscape table without it.
--
-- Grants on each view intentionally mirror the underlying table's grants
-- exactly (see 0008/0010 for the source of truth) — a view does not
-- inherit grants automatically, they must be restated. `security_invoker`
-- makes RLS behave correctly, but PostgREST/Postgres still requires an
-- explicit GRANT on the view object itself before any role can touch it.
--
-- These are simple single-table `SELECT *` views with no aggregation, so
-- Postgres treats them as automatically updatable — INSERT/UPDATE/DELETE
-- through the view pass straight through to the base table, still subject
-- to the base table's RLS via security_invoker.
--
-- Re-verification of RLS through these views (not just the base tables) is
-- required before this is considered done — see the companion note in the
-- vault tracker for the actual test run and results.

CREATE VIEW public.deals WITH (security_invoker = true) AS
  SELECT * FROM investscape.deals;
REVOKE ALL ON public.deals FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deals TO authenticated;

CREATE VIEW public.dev_studio_projects WITH (security_invoker = true) AS
  SELECT * FROM investscape.dev_studio_projects;
REVOKE ALL ON public.dev_studio_projects FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dev_studio_projects TO authenticated;

CREATE VIEW public.portfolios WITH (security_invoker = true) AS
  SELECT * FROM investscape.portfolios;
REVOKE ALL ON public.portfolios FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolios TO authenticated;

CREATE VIEW public.user_profiles WITH (security_invoker = true) AS
  SELECT * FROM investscape.user_profiles;
REVOKE ALL ON public.user_profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;

CREATE VIEW public.translations WITH (security_invoker = true) AS
  SELECT * FROM investscape.translations;
REVOKE ALL ON public.translations FROM anon, authenticated;
GRANT SELECT ON public.translations TO anon, authenticated;
