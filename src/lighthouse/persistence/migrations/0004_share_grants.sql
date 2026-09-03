-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0004.
--
-- Stage 4: client-selected analysis sharing. Persists `ShareGrant` from
-- domain/shareGrant.ts exactly — this migration adds no new business rules,
-- it only gives the already-tested domain type a durable home.
--
-- Same identity posture as migration 0002: every actor/subject reference is
-- opaque text, no email, no password, no session token, no launch URL, no
-- payment data anywhere in this table.

-- ---------------------------------------------------------------------------
-- Stage 4: share grants
-- ---------------------------------------------------------------------------
-- A grant rides on a confirmed cross-product link but is a SEPARATE consent —
-- linking is not sharing (receiver prompt §4/§10). Only the client who owns
-- the analyses may create a grant over them; that is enforced in the domain
-- layer (`CONSENT_ACTOR_MISMATCH`) and, at the repository boundary, ownership
-- is re-asserted inside the WHERE clause of every mutating query, never as a
-- separate read-then-check.
create table if not exists lighthouse.share_grants (
  share_grant_id             text        primary key,

  -- The confirmed cross-product link this grant rides on. Not a foreign key
  -- constraint to cross_product_links: the two products' link and grant
  -- lifecycles are independently owned, and a link's row may already be
  -- terminal by the time a grant referencing it is being read.
  cross_product_link_id      text        not null,

  -- The client who owns the analyses and gave consent. Never the professional.
  client_user_ref            text        not null,

  destination_relationship_ref text      not null,
  -- Which recipient context within that relationship may see it
  -- ('professional_assisted' | 'delegated_client').
  recipient_context           text       not null,

  -- Bounded per MAX_ANALYSES_PER_GRANT in domain/shareGrant.ts. The bound is
  -- enforced in the domain layer; the column itself is unbounded jsonb so a
  -- future domain-side limit change never requires a migration.
  selected_analysis_ids       jsonb      not null default '[]'::jsonb,
  -- Drawn only from SHAREABLE_FIELDS (contracts/crossProduct.ts).
  selected_fields             jsonb      not null default '[]'::jsonb,

  purpose                     text       not null,
  effective_from               timestamptz not null,
  expires_at                   timestamptz,

  -- The whole ConsentReceipt, stored verbatim as evidence of what the client
  -- actually saw and affirmed. Immutable once written — nothing here ever
  -- updates this column after insert.
  consent                      jsonb      not null,

  correlation_id               text       not null,

  -- Lifecycle (SHARE_GRANT_LIFECYCLE in domain/lifecycle.ts).
  state                        text       not null default 'active'
                                 check (state in ('active','expired','revoked','tombstoned')),
  -- Monotonic per grant. An older event must never overwrite a newer state.
  version                      integer    not null default 1 check (version >= 1),
  lifecycle_occurred_at        timestamptz not null default now(),
  -- Event ids already applied, for exact idempotency (mirrors LifecycleSnapshot).
  applied_event_ids            jsonb      not null default '[]'::jsonb,

  revoked_at                   timestamptz,

  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint share_grant_terminal_has_timestamp
    check (state <> 'revoked' or revoked_at is not null)
);

-- A professional's read-side query: "which grants currently address this
-- relationship + recipient context". Must never allow listing a client's
-- UNSHARED analyses — this index only ever backs a query that also filters on
-- state, so a revoked/tombstoned grant does not surface stale content.
create index if not exists idx_share_grants_relationship
  on lighthouse.share_grants (destination_relationship_ref, recipient_context)
  where state = 'active';

-- The client's own view of their grants.
create index if not exists idx_share_grants_client
  on lighthouse.share_grants (client_user_ref)
  where state = 'active';

create index if not exists idx_share_grants_link
  on lighthouse.share_grants (cross_product_link_id);

comment on table lighthouse.share_grants is
  'Stage 4 client-selected share grants. A grant confers read access to exactly the analyses and fields the client selected — nothing implied by the underlying link.';

-- ---------------------------------------------------------------------------
-- Lock the new table away from browser roles — service role only, same
-- deny-by-default posture as every other Lighthouse table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['share_grants'] loop
    execute format('alter table lighthouse.%I enable row level security', t);
    begin
      execute format('revoke all on lighthouse.%I from anon, authenticated', t);
    exception when undefined_object then
      raise notice 'Skipping revoke on %: browser roles not present', t;
    end;
  end loop;
end $$;
