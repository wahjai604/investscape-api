-- Migration 0009. Applied 2026-09-04, same day as 0008.
--
-- Corrects three promoted columns in 0008 that were guessed before checking
-- the real client object shapes. Verified directly against
-- investscape-v2-remastered.html (C:\Users\Eric\Investscape-Retired-
-- Reconstruction\investscape-v2-remastered.html) — blankNewDeal() (line
-- ~6535), syncActiveDealToList()/createNewDeal() (line ~3833) for deals;
-- state.devstudio.inputs (line ~3524) and syncActiveProjectToList()/
-- createNewProject() (line ~3870) for projects.
--
-- 0008 is already applied and checksummed, and the migration runner
-- deliberately hard-errors on a changed applied file rather than silently
-- re-applying — so this ships as a follow-up migration, not an edit to 0008,
-- even though both landed the same day and no client code depends on the
-- wrong columns yet (tables are empty).
--
-- deals — real shape is { id, name, deal: { address, country, assetType, ... },
-- extra: {...} }. `property_type`/`property_country`/`asset_category` never
-- existed as field names; the real values are `deal.assetType` and
-- `deal.country`, nested under `deal`, not top-level. `asset_category`
-- (Residential/Commercial) is derived client-side via an ASSET_TYPES lookup
-- table, never stored — no column for it here; a future migration can add
-- one if server-side filtering by category turns out to be needed, backed by
-- porting that same lookup table server-side rather than guessing again.
--
-- dev_studio_projects — real shape is { id, name, subtitle, seeded,
-- inputs: { provinceState, ... }, scenarios, waterfall, stages, ... }.
-- `property_country` never existed — there is no country field on a
-- dev studio project at all, only `inputs.provinceState` (a province, not a
-- country). Also missing `subtitle`, a real top-level field.

ALTER TABLE investscape.deals
  DROP COLUMN property_type,
  DROP COLUMN property_country,
  DROP COLUMN asset_category,
  ADD COLUMN asset_type text,   -- from payload.deal.assetType, e.g. 'multifamily-2-4'
  ADD COLUMN country    text;   -- from payload.deal.country

ALTER TABLE investscape.dev_studio_projects
  DROP COLUMN property_country,
  ADD COLUMN subtitle       text,  -- from payload.subtitle
  ADD COLUMN province_state text;  -- from payload.inputs.provinceState
