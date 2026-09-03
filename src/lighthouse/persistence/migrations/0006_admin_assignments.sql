-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0006.
--
-- Stage 7: cross-product administration. Persists `AdminAssignment` from
-- domain/adminAssignment.ts exactly — this migration adds no new business
-- rules, it only gives the already-tested domain type a durable home.
--
-- BOOTSTRAP IS NOT A ROW: the seed admin (LIGHTHOUSE_SEED_ADMIN_ACTOR_REF) is
-- resolved entirely in application code via `effectiveScopesFor` and never
-- appears in this table. Every row here is a normal, granted-by-someone
-- assignment, including any additional grant later made TO the seed actor.
--
-- Same identity posture as migration 0002/0004: every actor reference is
-- opaque text, no email, no password, no session token, no payment data.

create table if not exists lighthouse.admin_assignments (
  assignment_id              text        primary key,

  grantee_actor_ref          text        not null,
  granted_by_actor_ref       text        not null,

  -- Drawn only from INVESTSCAPE_ADMIN_SCOPES (domain/policy.ts). Enforced in
  -- the domain layer; the column itself is unbounded jsonb so a future scope
  -- addition never requires a migration.
  scopes                      jsonb      not null default '[]'::jsonb,

  purpose                     text       not null,
  effective_from              timestamptz not null,
  expires_at                  timestamptz,

  correlation_id              text       not null,

  -- Lifecycle (ADMIN_ASSIGNMENT_LIFECYCLE in domain/lifecycle.ts).
  state                        text       not null default 'active'
                                 check (state in ('active','suspended','revoked','expired')),
  -- Monotonic per assignment. An older event must never overwrite a newer state.
  version                      integer    not null default 1 check (version >= 1),
  lifecycle_occurred_at        timestamptz not null default now(),
  -- Event ids already applied, for exact idempotency (mirrors LifecycleSnapshot).
  applied_event_ids            jsonb      not null default '[]'::jsonb,

  revoked_at                   timestamptz,

  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint admin_assignment_terminal_has_timestamp
    check (state <> 'revoked' or revoked_at is not null)
);

-- "What are my current scopes" lookup — the route layer resolves a caller's
-- OWN active, non-bootstrap assignments via this index before folding in
-- `effectiveScopesFor`'s bootstrap override.
create index if not exists idx_admin_assignments_grantee_state
  on lighthouse.admin_assignments (grantee_actor_ref, state);

-- Backs the last-admin lockout guard's "how many OTHER active assignments
-- currently hold the management scope" count. A partial index on `state`
-- keeps that count query cheap without needing a generated column for the
-- single scope string, since containment queries over a small jsonb array
-- are already fast at this table's expected size; the repository's count
-- query filters `scopes @> '["investscape.configuration.manage"]'` under
-- this index's `where state = 'active'` predicate.
create index if not exists idx_admin_assignments_active
  on lighthouse.admin_assignments (state)
  where state = 'active';

comment on table lighthouse.admin_assignments is
  'Stage 7 cross-product admin assignments. The bootstrap seed admin is never a row here — only assignments granted through the normal escalation-guarded flow.';

-- ---------------------------------------------------------------------------
-- Lock the new table away from browser roles — service role only, same
-- deny-by-default posture as every other Lighthouse table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['admin_assignments'] loop
    execute format('alter table lighthouse.%I enable row level security', t);
    begin
      execute format('revoke all on lighthouse.%I from anon, authenticated', t);
    exception when undefined_object then
      raise notice 'Skipping revoke on %: browser roles not present', t;
    end;
  end loop;
end $$;
