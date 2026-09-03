-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0003.
--
-- Stage 3: coarse client-workspace availability disclosure.
--
-- A Stage 2 link alone grants nothing (see 0002's comment on
-- cross_product_links). This table records a SEPARATE, explicit consent: a
-- client actor choosing to reveal coarse workspace availability to one
-- specific relationship. Linking must never imply this consent, and this
-- table must never be inferred from — only read when a row explicitly says
-- `consented = true` and has not been revoked.
--
-- No plan, price, payment state, usage, or analysis data lives here or
-- anywhere near it. This table answers exactly one question: "may this
-- relationship be told whether the client's workspace is available at all."

create table if not exists lighthouse.workspace_disclosure_consents (
  id                      uuid        primary key default gen_random_uuid(),

  -- Which Stage 2 link this consent is attached to. A consent with no
  -- backing link is meaningless, so this is required, not optional.
  cross_product_link_id  text        not null
                            references lighthouse.cross_product_links (cross_product_link_id),

  -- The InvestScape actor (the client) granting or revoking disclosure.
  -- Ownership of a row is this column, always checked in the WHERE clause.
  client_actor_ref        text        not null,

  -- The Relationship OS relationship this consent applies to. Consent is
  -- scoped per relationship — never a blanket "reveal to everyone" toggle.
  relationship_ref        text        not null,

  consented                boolean     not null default false,
  consented_at             timestamptz,
  revoked_at               timestamptz,

  -- Monotonic per row. Not currently used for compare-and-set from the route
  -- layer, but present so a future optimistic-concurrency check does not
  -- require another migration.
  version                  integer     not null default 1 check (version >= 1),

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint consent_true_has_timestamp
    check (consented = false or consented_at is not null)
);

-- One consent row per (client actor, relationship). Setting consent again is
-- an upsert against this pair, not a new row.
create unique index if not exists uq_workspace_disclosure_actor_relationship
  on lighthouse.workspace_disclosure_consents (client_actor_ref, relationship_ref);

create index if not exists idx_workspace_disclosure_link
  on lighthouse.workspace_disclosure_consents (cross_product_link_id);

comment on table lighthouse.workspace_disclosure_consents is
  'Stage 3: per-relationship consent to reveal coarse InvestScape workspace availability. Never implied by a Stage 2 link.';

-- ---------------------------------------------------------------------------
-- Lock the new table away from browser roles — same posture as 0002.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter table lighthouse.workspace_disclosure_consents enable row level security';
  begin
    execute 'revoke all on lighthouse.workspace_disclosure_consents from anon, authenticated';
  exception when undefined_object then
    raise notice 'Skipping revoke on workspace_disclosure_consents: browser roles not present';
  end;
end $$;
