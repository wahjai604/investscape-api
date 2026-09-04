-- Migration 0010. Applied 2026-09-04, same day as 0008/0009.
--
-- Completes Phase 2 item 8's stated scope (0008's note #14 deferred these
-- three): investscape.portfolios, investscape.user_profiles,
-- investscape.translations.
--
-- Verified directly against investscape-v2-remastered.html
-- (C:\Users\Eric\Investscape-Retired-Reconstruction\investscape-v2-remastered.html)
-- rather than guessing from the task description, same discipline as 0009:
--
--   - state.portfolio.properties[] (search hits around lines 3953-6618) is
--     an array of { name, category, address, deal: {...full Analyzer deal},
--     dealStatus, includedInTotals, inclusionManuallySet } pushed at
--     lines 6505/6602. state.portfolio itself also carries filter, selected,
--     pinnedActive, customCategories, showNativeCurrency — those are
--     view/session state, not persisted membership data, so they are left
--     out of this table (they'd belong on a client-local or a future
--     per-user-preferences row, not here). No separate "wraps a Dev Studio
--     project" field exists on a portfolio property in the real app — a
--     property always wraps an Analyzer `deal` object; conversion to/from
--     Dev Studio, if it exists, does not touch this array's shape. This
--     contradicts the task prompt's suggestion that portfolio properties
--     might directly wrap either kind — verified false, called out below too.
--   - state.session.user (lines 698-699, 4716-4864, 13926-13979) is
--     { firstName, lastName, email, role, country }, matching the task
--     prompt's suggestion field-for-field. role is a closed enum
--     (ROLE_OPTIONS, line 13826): 'Investor','Realtor','Mortgage
--     Broker','Developer','Property Manager','Just Exploring'. country is
--     presently a closed Canada/US enum everywhere it's edited (settings +
--     profile tab), driving home currency — modeled as free text here
--     anyway since 0008/0009 already show the client-side enum list has
--     grown before (ASSET_TYPES) and a CHECK constraint would just need
--     another migration the day a third country is added.
--   - translations(key, lang, value) matches the Phase 2 project doc's
--     "i18n migration plan" section verbatim (long/normalized format, one
--     row per key+lang), sized for a direct CSV/JSON import of the existing
--     ~950-key x 3-language (fr, zh-Hant, zh-Hans) I18N dictionary. No
--     `payload` column here — unlike deals/dev_studio_projects this isn't a
--     loosely-typed client object, it's already a flat dictionary, so there
--     is nothing to defer normalizing.
--
-- RLS/grant posture:
--   - portfolios: per-user via auth.uid(), matching 0008's deals/
--     dev_studio_projects posture exactly (JSONB payload + promoted
--     indexed fields, same 4 policies, same schema-usage-gated grant to
--     authenticated only).
--   - user_profiles: per-user via auth.uid() too, but keyed 1:1 on
--     owner_id = auth.uid() (PRIMARY KEY, not a separate uuid id) since
--     it's a profile, not a collection — INSERT/UPDATE/DELETE all still
--     scoped to auth.uid() = owner_id so a user can only ever touch their
--     own row.
--   - translations: NOT per-user, it's a shared dictionary. SELECT is
--     opened to both anon and authenticated — WeWeb needs the marketing/
--     public-facing surfaces (e.g. a signed-out landing page) to render in
--     a chosen language too, and a translation string dictionary carries no
--     sensitive data, so there is no confidentiality reason to gate SELECT
--     behind auth the way deals/profiles are gated. Writes are denied to
--     both anon and authenticated (no INSERT/UPDATE/DELETE grants at all)
--     since there is no admin-role concept yet; population is via
--     service-role/direct-DB import per the Phase 2 doc's CSV/JSON import
--     plan, not through PostgREST.
--
-- Reuses investscape.touch_updated_at() created by 0008 — not recreated
-- here. 0008's schema-level GRANT USAGE ... TO authenticated already
-- covers this migration's per-user tables, not repeated. Its
-- `REVOKE ALL ON SCHEMA investscape FROM anon` is *not* still fully
-- correct after this migration, though — PostgREST checks schema-level
-- USAGE before any table grant, so anon needs schema USAGE too or the
-- translations SELECT grant below would be unreachable. Schema USAGE
-- alone reveals nothing (it does not expose column names or data, only
-- makes the schema door openable); anon's actual data access is still
-- gated table-by-table, and anon gets nothing beyond the one SELECT grant
-- given to investscape.translations at the bottom of this file.
GRANT USAGE ON SCHEMA investscape TO anon;

-- ---------------------------------------------------------------------------
-- portfolios — one row per held/tracked property, wrapping an Analyzer deal
-- ---------------------------------------------------------------------------
CREATE TABLE investscape.portfolios (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                     text,           -- payload.name — property label shown in Portfolio list
  category                 text,           -- payload.category — free-text/custom category, not a fixed enum client-side
  address                  text,           -- payload.address
  deal_status              text,           -- payload.dealStatus, e.g. 'owned'
  included_in_totals       boolean NOT NULL DEFAULT true,   -- payload.includedInTotals
  inclusion_manually_set   boolean NOT NULL DEFAULT false,  -- payload.inclusionManuallySet
  payload                  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- full property object incl. nested `deal`
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);

CREATE INDEX portfolios_owner_id_idx ON investscape.portfolios(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX portfolios_payload_gin_idx ON investscape.portfolios USING gin(payload);

ALTER TABLE investscape.portfolios ENABLE ROW LEVEL SECURITY;

CREATE POLICY portfolios_select_own ON investscape.portfolios
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY portfolios_insert_own ON investscape.portfolios
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY portfolios_update_own ON investscape.portfolios
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY portfolios_delete_own ON investscape.portfolios
  FOR DELETE USING (auth.uid() = owner_id);

REVOKE ALL ON investscape.portfolios FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON investscape.portfolios TO authenticated;

CREATE TRIGGER portfolios_touch_updated_at
  BEFORE UPDATE ON investscape.portfolios
  FOR EACH ROW EXECUTE FUNCTION investscape.touch_updated_at();

-- ---------------------------------------------------------------------------
-- user_profiles — one row per Supabase Auth user, InvestScape-side profile
-- ---------------------------------------------------------------------------
CREATE TABLE investscape.user_profiles (
  owner_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name   text,
  last_name    text,
  email        text,   -- mirrors auth.users.email for read convenience; app treats it as read-only (no email-change flow yet)
  role         text NOT NULL DEFAULT 'Investor',  -- ROLE_OPTIONS enum client-side: Investor, Realtor, Mortgage Broker, Developer, Property Manager, Just Exploring
  country      text,   -- home country, drives cross-border tax & currency; Canada/US in the current client, kept free-text server-side
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE investscape.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_select_own ON investscape.user_profiles
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY user_profiles_insert_own ON investscape.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY user_profiles_update_own ON investscape.user_profiles
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY user_profiles_delete_own ON investscape.user_profiles
  FOR DELETE USING (auth.uid() = owner_id);

REVOKE ALL ON investscape.user_profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON investscape.user_profiles TO authenticated;

CREATE TRIGGER user_profiles_touch_updated_at
  BEFORE UPDATE ON investscape.user_profiles
  FOR EACH ROW EXECUTE FUNCTION investscape.touch_updated_at();

-- ---------------------------------------------------------------------------
-- translations — shared i18n dictionary (key, lang, value), long/normalized
-- format sized for a direct import of the existing I18N object export
-- ---------------------------------------------------------------------------
CREATE TABLE investscape.translations (
  key         text NOT NULL,
  lang        text NOT NULL,
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, lang)
);

ALTER TABLE investscape.translations ENABLE ROW LEVEL SECURITY;

-- Shared/public dictionary data, not owner-scoped — SELECT is open to
-- everyone (see posture note above); no INSERT/UPDATE/DELETE policy exists
-- for anon or authenticated, so those verbs stay unreachable even from a
-- future GRANT, and RLS is enabled to match the rest of this schema's
-- posture (belt-and-suspenders alongside the grants below, which are the
-- actual gate here).
CREATE POLICY translations_select_all ON investscape.translations
  FOR SELECT USING (true);

REVOKE ALL ON investscape.translations FROM anon, authenticated;
GRANT SELECT ON investscape.translations TO anon, authenticated;

CREATE TRIGGER translations_touch_updated_at
  BEFORE UPDATE ON investscape.translations
  FOR EACH ROW EXECUTE FUNCTION investscape.touch_updated_at();
