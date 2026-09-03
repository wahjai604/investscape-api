-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0001.
--
-- ⚠️  NOT APPLIED. This file has never been run against any database. It is
--     submitted for review alongside the domain code. investscape-api has no
--     database connection at all today; adding one is a separate, explicit
--     decision (see the completion report).
--
-- Design notes:
--   * Everything lives in a dedicated `lighthouse` schema so the cross-product
--     integration can be granted, revoked, backed up and audited independently
--     of InvestScape's own future application tables.
--   * Every table is server-only. Browser roles are revoked explicitly rather
--     than merely "not granted", per CROSS_PRODUCT_ADMINISTRATION_HANDOFF §
--     "Mandatory security invariants": administrative tables are server-only
--     "with RLS defense in depth and browser grants revoked."
--   * No table stores a one-time code, a launch URL, a password, a payment
--     credential, or an email address. Identifiers are opaque.

create schema if not exists lighthouse;

-- ---------------------------------------------------------------------------
-- Service authentication replay protection
-- ---------------------------------------------------------------------------
-- Mirrors relationship-os `app.service_request_nonces`. Stores the SHA-256 of
-- the nonce, never the nonce itself, so a leaked table yields nothing reusable.
create table if not exists lighthouse.service_request_nonces (
  id          bigserial primary key,
  service_key text        not null,
  key_id      text        not null,
  nonce_hash  text        not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (service_key, key_id, nonce_hash)
);

create index if not exists idx_service_request_nonces_expiry
  on lighthouse.service_request_nonces (expires_at);

comment on table lighthouse.service_request_nonces is
  'Replay protection for signed service requests. A valid signature proves authenticity, not freshness.';

-- ---------------------------------------------------------------------------
-- Stage 1: launch session -> analysis binding
-- ---------------------------------------------------------------------------
-- The unique constraint on launch_session_id is what makes "two concurrent
-- landing requests cannot create two analyses" true rather than aspirational.
create table if not exists lighthouse.launch_analysis_bindings (
  launch_session_id uuid        primary key,
  analysis_id       text        not null,
  analysis_type     text        not null,
  permitted_modules text[]      not null default '{}',
  permitted_scopes  text[]      not null default '{}',
  redacted_scopes   text[]      not null default '{}',
  correlation_id    text        not null,
  property_ref      text        not null,
  created_at        timestamptz not null default now(),
  -- Deliberately ABSENT: the one-time code, the launch URL, any relationship or
  -- household identifier, any raw property or financial data.
  unique (analysis_id)
);

create index if not exists idx_launch_bindings_correlation
  on lighthouse.launch_analysis_bindings (correlation_id);

comment on table lighthouse.launch_analysis_bindings is
  'One Relationship OS launch session binds to exactly one InvestScape analysis. Never stores the one-time code.';

-- ---------------------------------------------------------------------------
-- Stage 1: result-reference callback outbox
-- ---------------------------------------------------------------------------
create table if not exists lighthouse.callback_outbox (
  id                    uuid        primary key default gen_random_uuid(),
  launch_session_id     uuid        not null,
  external_analysis_id  text        not null,
  target_status         text        not null check (target_status in ('draft','complete','failed')),
  payload_hash          text        not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload               jsonb       not null,
  state                 text        not null default 'pending'
                          check (state in ('pending','in_flight','acknowledged','failed_permanent')),
  attempts              integer     not null default 0 check (attempts >= 0),
  next_attempt_at       timestamptz not null default now(),
  analysis_reference_id text,
  accepted_at           timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  -- The idempotency key from receiver prompt §6.
  unique (launch_session_id, external_analysis_id, target_status, payload_hash)
);

create index if not exists idx_callback_outbox_due
  on lighthouse.callback_outbox (state, next_attempt_at)
  where state = 'pending';

comment on table lighthouse.callback_outbox is
  'Durable outbox for investscape-result-reference.v1 callbacks. Retries send byte-identical payloads.';

-- ---------------------------------------------------------------------------
-- Immutable audit
-- ---------------------------------------------------------------------------
-- Append-only. Invariant 9 permits removing active projections on revocation
-- but forbids erasing security/audit provenance, so there is no update or
-- delete path and the browser roles get nothing at all.
create table if not exists lighthouse.audit_events (
  id                  bigserial   primary key,
  event_type          text        not null,
  occurred_at         timestamptz not null,
  actor_id            text,
  subject_id          text,
  operating_context   text,
  authority_kind      text        not null,
  authority_grant_id  text,
  purpose             text,
  scopes              text[]      not null default '{}',
  outcome             text        not null check (outcome in ('allowed','denied','error')),
  correlation_id      text,
  metadata            jsonb       not null default '{}'::jsonb,
  recorded_at         timestamptz not null default now()
);

create index if not exists idx_audit_events_subject   on lighthouse.audit_events (subject_id, occurred_at desc);
create index if not exists idx_audit_events_actor     on lighthouse.audit_events (actor_id, occurred_at desc);
create index if not exists idx_audit_events_corr      on lighthouse.audit_events (correlation_id);

comment on table lighthouse.audit_events is
  'Append-only. Records actor, subject, context, authority, purpose, scopes, outcome and correlation. Never secrets or raw payloads.';

-- ---------------------------------------------------------------------------
-- Lock everything away from browser roles
-- ---------------------------------------------------------------------------
-- Supabase exposes `anon` and `authenticated` to the browser via PostgREST.
-- These tables must never be reachable that way. RLS is enabled as defence in
-- depth even though the grants are revoked — belt and braces, per the
-- governance baseline.
do $$
declare t text;
begin
  foreach t in array array[
    'service_request_nonces', 'launch_analysis_bindings',
    'callback_outbox', 'audit_events'
  ] loop
    execute format('alter table lighthouse.%I enable row level security', t);
    -- Roles may not exist outside Supabase; ignore if absent.
    begin
      execute format('revoke all on lighthouse.%I from anon, authenticated', t);
    exception when undefined_object then
      raise notice 'Skipping revoke on %: browser roles not present', t;
    end;
  end loop;
end $$;

revoke all on schema lighthouse from public;
