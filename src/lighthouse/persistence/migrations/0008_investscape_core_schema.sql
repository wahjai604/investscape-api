-- Migration 0008. Applied 2026-09-04, verified against the real Investscape-Dev
-- Supabase project (session pooler), not just read from this file.
--
-- IMPORTANT — a step outside this migration is also required before WeWeb can
-- reach these tables: Supabase's Data API only serves schemas on its explicit
-- "exposed schemas" allow-list (Project Settings -> API -> Exposed schemas).
-- `investscape` must be added there manually in the dashboard; no migration
-- can do this, it is not a SQL-level setting. Until that's done these tables
-- are reachable from investscape-api's own direct Postgres connection but
-- NOT from PostgREST/WeWeb, which is a safe default to leave in place until
-- the tables are actually ready for a client to hit.
--
-- Scope: first pass per Eric's 2026-09-03 decision —
--   - deals + dev_studio_projects only (portfolios/user_profiles/translations deferred)
--   - RLS: per-user via auth.uid(), NOT service-role-only like lighthouse.*
--   - Data path: WeWeb reads/writes these tables directly via Supabase PostgREST;
--     investscape-api stays a pure calculation service for the 76 engine routes,
--     no CRUD endpoints added there for this data.
--
-- Open questions this draft does NOT resolve (flag to Eric before applying):
--   1. Exact column shape for deal/project payloads — the HTML app currently stores
--      these as loosely-typed JS objects in localStorage (see blankNewDeal(),
--      DEFAULT_DEVSTUDIO_INPUTS in investscape-v2-remastered.html). This draft uses
--      a JSONB payload column + a few promoted/indexed fields rather than fully
--      normalizing every field, to avoid guessing a schema ahead of the real data
--      shape. Promote more fields to real columns once WeWeb screens are being built
--      against this and query patterns are known.
--   2. Whether `__seeded`/`seeded` (the starter-numbers flag from the Flow & Module
--      Depth Audit fix) needs to persist server-side or is UI-local only — left out
--      of this draft, add if needed.
--   3. Soft-delete vs hard-delete — this draft uses soft-delete (`deleted_at`) since
--      deals/projects are meaningful business records; confirm that's wanted.

CREATE SCHEMA IF NOT EXISTS investscape;

-- PostgREST checks schema-level USAGE before it ever reaches a table grant or
-- an RLS policy. Without this, `authenticated` would be blocked at the schema
-- door regardless of the per-table grants below. `anon` deliberately gets
-- nothing here — there is no anonymous-accessible data in this schema.
GRANT USAGE ON SCHEMA investscape TO authenticated;
REVOKE ALL ON SCHEMA investscape FROM anon;

-- ---------------------------------------------------------------------------
-- deals — Deal Analyzer saves (currently localStorage only)
-- ---------------------------------------------------------------------------
CREATE TABLE investscape.deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address         text,
  property_type   text,
  property_country text,
  asset_category  text,           -- 'residential' | 'commercial', drives UI branching
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- full deal object (see open Q1)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX deals_owner_id_idx ON investscape.deals(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX deals_payload_gin_idx ON investscape.deals USING gin(payload);

ALTER TABLE investscape.deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY deals_select_own ON investscape.deals
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY deals_insert_own ON investscape.deals
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY deals_update_own ON investscape.deals
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY deals_delete_own ON investscape.deals
  FOR DELETE USING (auth.uid() = owner_id);

-- Explicit browser-role revoke, matching the lighthouse.* migrations' posture —
-- PostgREST/Supabase Data API access must come only through RLS-governed grants,
-- never a default table privilege.
REVOKE ALL ON investscape.deals FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON investscape.deals TO authenticated;

-- ---------------------------------------------------------------------------
-- dev_studio_projects — Dev Studio saves (currently localStorage only)
-- ---------------------------------------------------------------------------
CREATE TABLE investscape.dev_studio_projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text,
  property_country text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- full project object (see open Q1)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX dev_studio_projects_owner_id_idx ON investscape.dev_studio_projects(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX dev_studio_projects_payload_gin_idx ON investscape.dev_studio_projects USING gin(payload);

ALTER TABLE investscape.dev_studio_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsp_select_own ON investscape.dev_studio_projects
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY dsp_insert_own ON investscape.dev_studio_projects
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY dsp_update_own ON investscape.dev_studio_projects
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY dsp_delete_own ON investscape.dev_studio_projects
  FOR DELETE USING (auth.uid() = owner_id);

REVOKE ALL ON investscape.dev_studio_projects FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON investscape.dev_studio_projects TO authenticated;

-- ---------------------------------------------------------------------------
-- updated_at auto-touch (mirrors common Supabase pattern; add trigger fn once
-- if not already present elsewhere in the migration set)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION investscape.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deals_touch_updated_at
  BEFORE UPDATE ON investscape.deals
  FOR EACH ROW EXECUTE FUNCTION investscape.touch_updated_at();

CREATE TRIGGER dsp_touch_updated_at
  BEFORE UPDATE ON investscape.dev_studio_projects
  FOR EACH ROW EXECUTE FUNCTION investscape.touch_updated_at();
