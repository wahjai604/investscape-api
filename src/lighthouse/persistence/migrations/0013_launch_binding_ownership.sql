-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0013.
--
-- Launch-binding ownership (P1 defect 1). A launched analysis must record:
--   professional_actor_ref  the InvestScape actor (auth.uid()) who owns it
--   operating_context       always 'professional_assisted' — never 'personal'
--   initiator_person_ref    the Relationship OS person who issued the launch
--   cross_product_link_id   the ACTIVE link that proved the two are one person
-- See src/lighthouse/stage1/launchOwnership.ts for the binding rule.
--
-- Existing rows: there is no truthful owner to backfill (v1 launches never
-- named one), and Stage 1 has never been enabled. The guard below refuses to
-- run if any row exists, rather than inventing ownership or leaving unowned
-- rows readable. Resolve such rows by hand before applying.

do $$
begin
  if exists (select 1 from lighthouse.launch_analysis_bindings) then
    raise exception
      'launch_analysis_bindings has rows without an owner; refusing to backfill. Resolve manually before migration 0013.';
  end if;
end $$;

alter table lighthouse.launch_analysis_bindings
  add column if not exists professional_actor_ref text not null,
  add column if not exists operating_context      text not null
    constraint launch_binding_context_is_assisted check (operating_context = 'professional_assisted'),
  add column if not exists initiator_person_ref   text not null,
  add column if not exists cross_product_link_id  text not null;

-- A professional's own launched analyses. Never queried by a client, and never
-- joined to investscape.* personal-workspace tables.
create index if not exists idx_launch_bindings_professional
  on lighthouse.launch_analysis_bindings (professional_actor_ref);

comment on column lighthouse.launch_analysis_bindings.professional_actor_ref is
  'InvestScape actor who owns this launched analysis. Set only when the signed launch initiator matches an active cross-product link to this actor.';
