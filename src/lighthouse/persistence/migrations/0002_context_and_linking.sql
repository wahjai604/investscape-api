-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0002.
--
-- Adds the tables that make two things real which were previously only
-- interfaces:
--   1. server-resolved operating context (lighthouse.context_authorities)
--   2. Stage 2 cross-product identity linking
--
-- IDENTITY NOTE. InvestScape has no user table of its own today. Rather than
-- invent a parallel identity system (explicitly forbidden: "do not create a
-- parallel identity ... system when a compatible current primitive can be
-- extended safely"), every actor/subject here is an OPAQUE TEXT REFERENCE.
-- Under Supabase that reference is `auth.uid()`. There is deliberately NO
-- foreign key to `auth.users`, so this schema also applies to a plain Postgres
-- database for tests and local development, and so the identity provider can
-- change without a migration.
--
-- No table below stores an email address, a password, a session token, a
-- one-time code, a launch URL, or any payment credential.

-- ---------------------------------------------------------------------------
-- Operating context authorities
-- ---------------------------------------------------------------------------
-- This is the table `resolveOperatingContext` reads through `lookupAuthority`.
-- Invariant 1: the browser may REQUEST a context; only a row here grants one.
--
-- One actor may hold many rows simultaneously — that is the point. A
-- professional legitimately has a `personal` row for their own portfolio AND
-- one `delegated_client` row per client mandate. This is why the resolver
-- requires a relationship reference to disambiguate `delegated_client`.
create table if not exists lighthouse.context_authorities (
  id                 uuid        primary key default gen_random_uuid(),

  -- The authenticated actor performing the request (Supabase auth.uid()).
  actor_ref          text        not null,

  -- Whose portfolio is being operated on. Equals actor_ref only for 'personal'.
  subject_ref        text        not null,

  kind               text        not null
                       check (kind in ('personal','professional_assisted','delegated_client','organization')),

  -- What justifies this context: 'self' | 'launch_session' | 'delegation_mandate' | ...
  authority_kind     text        not null,
  -- The specific grant (mandate id, launch session id). Null for 'self'.
  authority_grant_id text,

  -- Which relationship this context is scoped to. REQUIRED for
  -- delegated_client; that is how a professional selects WHICH client.
  relationship_ref   text,

  scopes             text[]      not null default '{}',

  status             text        not null default 'active'
                       check (status in ('active','suspended','expired','revoked')),

  effective_from     timestamptz,
  expires_at         timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- 'personal' means acting for yourself. Enforced in the database as well as
  -- in resolveOperatingContext, because a mis-shaped row here would otherwise
  -- silently grant access to another person's portfolio.
  constraint personal_actor_is_subject
    check (kind <> 'personal' or actor_ref = subject_ref),

  -- delegated_client without a relationship is ambiguous and must not exist.
  constraint delegated_requires_relationship
    check (kind <> 'delegated_client' or relationship_ref is not null)
);

-- One authority per (actor, kind, relationship). COALESCE because Postgres
-- treats NULLs as distinct in unique constraints, which would otherwise permit
-- duplicate 'personal' rows for the same actor.
create unique index if not exists uq_context_authorities_actor_kind_rel
  on lighthouse.context_authorities (actor_ref, kind, coalesce(relationship_ref, ''));

create index if not exists idx_context_authorities_lookup
  on lighthouse.context_authorities (actor_ref, kind)
  where status = 'active';

create index if not exists idx_context_authorities_subject
  on lighthouse.context_authorities (subject_ref);

comment on table lighthouse.context_authorities is
  'Server-owned operating-context grants. The browser may request a context; only a row here grants one.';

-- ---------------------------------------------------------------------------
-- Stage 2: cross-product link invitations
-- ---------------------------------------------------------------------------
-- Single-use, short-expiry challenge. Only the SHA-256 of the challenge is
-- stored, so a leaked table yields nothing redeemable.
create table if not exists lighthouse.link_invitations (
  invitation_id            text        primary key,
  relationship_os_person_ref text      not null,
  relationship_ref         text        not null,
  challenge_hash           text        not null check (challenge_hash ~ '^[0-9a-f]{64}$'),
  notice_version           text        not null,
  expires_at               timestamptz not null,
  consumed_at              timestamptz,
  -- Set when consumed, so a replay can be distinguished from a fresh attempt.
  consumed_by_actor_ref    text,
  correlation_id           text        not null,
  created_at               timestamptz not null default now()
  -- Deliberately ABSENT: email, name, phone, any profile field. Linking by
  -- email equality is structurally impossible because the column does not exist.
);

create index if not exists idx_link_invitations_expiry
  on lighthouse.link_invitations (expires_at)
  where consumed_at is null;

comment on table lighthouse.link_invitations is
  'Single-use Stage 2 link challenges. Stores only the challenge hash. Has no email column by design.';

-- ---------------------------------------------------------------------------
-- Stage 2: confirmed cross-product links
-- ---------------------------------------------------------------------------
create table if not exists lighthouse.cross_product_links (
  cross_product_link_id      text        primary key,
  relationship_os_person_ref text        not null,
  investscape_actor_ref      text        not null,
  relationship_ref           text        not null,

  state                      text        not null default 'pending'
                               check (state in ('pending','active','suspended','revoked','expired')),
  -- Monotonic per link. An older event must never overwrite a newer state.
  version                    integer     not null default 0 check (version >= 0),

  notice_version             text        not null,
  accepted_at                timestamptz,
  revoked_at                 timestamptz,
  correlation_id             text        not null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  -- One active link per (person, actor) pair. Revoked/expired links are
  -- terminal and keep their row for audit provenance, so this is partial.
  constraint link_terminal_has_timestamp
    check (state <> 'revoked' or revoked_at is not null)
);

create unique index if not exists uq_cross_product_links_active_pair
  on lighthouse.cross_product_links (relationship_os_person_ref, investscape_actor_ref)
  where state in ('pending','active','suspended');

create index if not exists idx_cross_product_links_actor
  on lighthouse.cross_product_links (investscape_actor_ref);

comment on table lighthouse.cross_product_links is
  'Confirmed Stage 2 links. Grants NOTHING by itself — not sharing, not subscription, not delegation.';

-- ---------------------------------------------------------------------------
-- Inbound event idempotency (Stage 6)
-- ---------------------------------------------------------------------------
-- The durable half of the payload-hash idempotency fix. Binding event_id to a
-- canonical payload hash means a reused event id carrying DIFFERENT bytes is a
-- detectable conflict, not a silently-swallowed duplicate.
create table if not exists lighthouse.inbound_events (
  event_id       text        primary key,
  schema_version text        not null,
  aggregate_id   text        not null,
  aggregate_kind text        not null,
  version        integer     not null check (version >= 0),
  payload_hash   text        not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  outcome        text        not null
                   check (outcome in ('applied','duplicate','stale','rejected','conflict')),
  occurred_at    timestamptz not null,
  received_at    timestamptz not null default now(),
  correlation_id text
);

create index if not exists idx_inbound_events_aggregate
  on lighthouse.inbound_events (aggregate_kind, aggregate_id, version);

comment on table lighthouse.inbound_events is
  'Idempotency ledger. event_id is bound to a payload hash; a reused id with different bytes is a conflict, never a duplicate.';

-- ---------------------------------------------------------------------------
-- Lock the new tables away from browser roles
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'context_authorities', 'link_invitations',
    'cross_product_links', 'inbound_events', 'schema_migrations'
  ] loop
    execute format('alter table lighthouse.%I enable row level security', t);
    begin
      execute format('revoke all on lighthouse.%I from anon, authenticated', t);
    exception when undefined_object then
      raise notice 'Skipping revoke on %: browser roles not present', t;
    end;
  end loop;
end $$;

revoke all on schema lighthouse from public;
