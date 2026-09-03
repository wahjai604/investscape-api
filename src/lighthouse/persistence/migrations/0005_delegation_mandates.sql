-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0005.
--
-- Stage 8: delegated client portfolio management (Mode D). Persists
-- `DelegationRequest` and `DelegationMandate` from domain/delegationMandate.ts
-- exactly — this migration adds no new business rules, it only gives the
-- already-tested domain types a durable home.
--
-- Same identity posture as migrations 0002/0004: every actor/subject
-- reference is opaque text, no email, no password, no session token, no
-- launch URL, no payment data anywhere in this table.
--
-- DISABLED CAPABILITY: nothing in Stage 8 is reachable until
-- lighthouse.delegated_portfolio_management is deliberately enabled, which it
-- is not. This migration only creates durable storage for the design.

-- ---------------------------------------------------------------------------
-- Stage 8: delegation requests
-- ---------------------------------------------------------------------------
-- A professional's ASK. Single-use: consumed_at is claimed exactly once by
-- the accept path's conditional UPDATE, mirroring migration 0002's
-- link_invitations.
create table if not exists lighthouse.delegation_requests (
  request_id                text        primary key,

  professional_user_ref     text        not null,
  client_user_ref            text        not null,
  relationship_ref           text        not null,
  -- Proof of a current Relationship OS representation.
  representation_ref         text        not null,

  -- Drawn only from DELEGATED_PORTFOLIO_SCOPES (domain/policy.ts).
  requested_scopes           jsonb       not null default '[]'::jsonb,

  purpose                    text        not null,
  notice_version              text       not null,

  -- SHA-256 of the single-use acceptance challenge. Only the hash is ever
  -- persisted — the plaintext is returned once, in the create response.
  challenge_hash              text       not null,

  expires_at                  timestamptz not null,
  correlation_id               text      not null,

  -- Single-use claim. Null until accepted; the accept path claims this with a
  -- conditional UPDATE (`where consumed_at is null`), which is the actual
  -- single-use enforcement point, not the domain check alone.
  consumed_at                  timestamptz,

  created_at                   timestamptz not null default now()
);

create index if not exists idx_delegation_requests_professional
  on lighthouse.delegation_requests (professional_user_ref);

create index if not exists idx_delegation_requests_client
  on lighthouse.delegation_requests (client_user_ref);

comment on table lighthouse.delegation_requests is
  'Stage 8 delegation requests. A professional may only ASK — this table alone confers no access. Single-use, claimed atomically by acceptance.';

-- ---------------------------------------------------------------------------
-- Stage 8: delegation mandates
-- ---------------------------------------------------------------------------
-- The result of a client's acceptance. This is the ONLY row that grants
-- delegated access, and it exists only after both self-dealing guards in
-- domain/delegationMandate.ts have passed.
create table if not exists lighthouse.delegation_mandates (
  mandate_id                  text        primary key,

  professional_user_ref       text        not null,
  client_user_ref              text       not null,
  relationship_ref             text       not null,
  representation_ref           text       not null,
  -- The InvestScape portfolio this mandate is bound to.
  portfolio_ref                text       not null,

  -- Granted permissions. Default empty — everything is off unless granted.
  scopes                       jsonb      not null default '[]'::jsonb,

  purpose                      text       not null,
  notice_version                 text     not null,

  effective_from                timestamptz not null,
  expires_at                     timestamptz not null,
  accepted_by_client_at          timestamptz not null,

  correlation_id                 text     not null,

  -- Lifecycle (MANDATE_LIFECYCLE in domain/lifecycle.ts).
  state                          text     not null default 'active'
                                   check (state in
                                     ('requested','pending_client_acceptance',
                                      'active','suspended','expired','revoked')),
  -- Monotonic per mandate. An older event must never overwrite a newer state.
  version                        integer  not null default 1 check (version >= 1),
  lifecycle_occurred_at          timestamptz not null default now(),
  -- Event ids already applied, for exact idempotency (mirrors LifecycleSnapshot).
  applied_event_ids              jsonb    not null default '[]'::jsonb,

  revoked_at                     timestamptz,

  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),

  constraint delegation_mandate_terminal_has_timestamp
    check (state <> 'revoked' or revoked_at is not null)
);

-- The client's own view of their mandates.
create index if not exists idx_delegation_mandates_client
  on lighthouse.delegation_mandates (client_user_ref)
  where state in ('active','suspended');

-- The professional's own view of the mandates they hold.
create index if not exists idx_delegation_mandates_professional
  on lighthouse.delegation_mandates (professional_user_ref)
  where state in ('active','suspended');

comment on table lighthouse.delegation_mandates is
  'Stage 8 delegated client mandates (Mode D). A mandate confers exactly the granted scopes — nothing implied by the underlying request or link. DISABLED CAPABILITY pending product/legal review.';

-- ---------------------------------------------------------------------------
-- Lock the new tables away from browser roles — service role only, same
-- deny-by-default posture as every other Lighthouse table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['delegation_requests', 'delegation_mandates'] loop
    execute format('alter table lighthouse.%I enable row level security', t);
    begin
      execute format('revoke all on lighthouse.%I from anon, authenticated', t);
    exception when undefined_object then
      raise notice 'Skipping revoke on %: browser roles not present', t;
    end;
  end loop;
end $$;
