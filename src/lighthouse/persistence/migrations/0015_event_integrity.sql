-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0015.
--
-- Stage 6 event integrity, contract v0.3 r3 §3.2–§3.4 (commit 559fee8).
--
--   event_quarantines  one row per quarantine; at most ONE open per aggregate
--   event_ledger       eventId -> the digest FIRST accepted under it
--   event_variants     one row per distinct (eventId, eventDigest) received,
--                      each with its own recorded outcome and quarantine
--   version_ledger     (aggregate, version) -> versionContentDigest first
--                      accepted for that version
--
-- No table here stores an event body or payload. Blocked bodies are discarded
-- by design (§3.4): the sender keeps them and resubmits.
--
-- The immutability rules the contract states in prose are enforced by
-- triggers, so a later code change cannot quietly rewrite history:
--   * event_ledger and version_ledger rows are never updated or deleted;
--   * an event_variants row may only (a) count a retry, (b) gain
--     resolved_outcome = 'superseded' once, or (c) have a 'blocked' outcome
--     replaced by its re-evaluated outcome (§3.4 step 6);
--   * a quarantine may only move open -> resolved, never back.
--
-- `lighthouse.inbound_events` (0002) is superseded by these tables and is no
-- longer written. It is left in place, unchanged, so no history is dropped.

create table if not exists lighthouse.event_quarantines (
  quarantine_id  text        primary key,
  aggregate_kind text        not null,
  aggregate_id   text        not null,
  version        integer     not null check (version >= 1),
  kind           text        not null
                   check (kind in ('EVENT_ID_DIGEST_MISMATCH',
                                   'AGGREGATE_VERSION_CONTENT_MISMATCH',
                                   'REJECTED_TRANSITION')),
  state          text        not null default 'open' check (state in ('open','resolved')),
  opened_at      timestamptz not null,
  resolution     text        check (resolution in ('adopted_owner_state','operator_override')),
  resolved_by    text,
  resolved_at    timestamptz,

  constraint event_quarantines_resolution_fields check (
    (state = 'open'     and resolution is null     and resolved_by is null     and resolved_at is null) or
    (state = 'resolved' and resolution is not null and resolved_by is not null and resolved_at is not null)
  )
);

-- The block (§3.4 step 3) is "an open quarantine exists for the aggregate".
-- A second conflict JOINS the open one rather than opening another.
create unique index if not exists uq_event_quarantines_one_open_per_aggregate
  on lighthouse.event_quarantines (aggregate_kind, aggregate_id)
  where state = 'open';

create table if not exists lighthouse.event_ledger (
  event_id              text        primary key,
  accepted_event_digest text        not null check (accepted_event_digest ~ '^[0-9a-f]{64}$'),
  aggregate_kind        text        not null,
  aggregate_id          text        not null,
  version               integer     not null check (version >= 1),
  first_received_at     timestamptz not null
);

create table if not exists lighthouse.event_variants (
  event_id          text        not null references lighthouse.event_ledger (event_id),
  event_digest      text        not null check (event_digest ~ '^[0-9a-f]{64}$'),
  role              text        not null check (role in ('original','conflicting')),
  outcome           text        not null
                      check (outcome in ('applied','applied_with_gap','duplicate','stale',
                                         'conflict','blocked','rejected_transition')),
  resolved_outcome  text        check (resolved_outcome = 'superseded'),
  conflict_kind     text        check (conflict_kind in ('EVENT_ID_DIGEST_MISMATCH',
                                                         'AGGREGATE_VERSION_CONTENT_MISMATCH')),
  quarantine_id     text        references lighthouse.event_quarantines (quarantine_id),
  alias_of_event_id text,
  -- What THIS variant claimed, echoed on replay. May differ from the ledger's
  -- aggregate for a conflicting variant.
  aggregate_kind    text        not null,
  aggregate_id      text        not null,
  version           integer     not null check (version >= 1),
  received_count    integer     not null default 1 check (received_count >= 1),
  first_received_at timestamptz not null,
  last_received_at  timestamptz not null,

  primary key (event_id, event_digest),

  constraint event_variants_quarantine_iff_open_issue check (
    (outcome in ('conflict','blocked','rejected_transition')) = (quarantine_id is not null)
  ),
  constraint event_variants_conflict_kind_iff_conflict check (
    (outcome = 'conflict') = (conflict_kind is not null)
  ),
  constraint event_variants_alias_only_on_duplicate check (
    alias_of_event_id is null or outcome = 'duplicate'
  ),
  constraint event_variants_superseded_only_for_quarantined check (
    resolved_outcome is null or outcome in ('conflict','rejected_transition')
  ),
  constraint event_variants_conflicting_role_is_conflict check (
    role = 'original' or outcome = 'conflict'
  )
);

-- Exactly one original per eventId.
create unique index if not exists uq_event_variants_one_original
  on lighthouse.event_variants (event_id)
  where role = 'original';

create index if not exists idx_event_variants_quarantine
  on lighthouse.event_variants (quarantine_id)
  where quarantine_id is not null;

create table if not exists lighthouse.version_ledger (
  aggregate_kind         text        not null,
  aggregate_id           text        not null,
  version                integer     not null check (version >= 1),
  version_content_digest text        not null check (version_content_digest ~ '^[0-9a-f]{64}$'),
  first_event_id         text        not null references lighthouse.event_ledger (event_id),
  recorded_at            timestamptz not null,
  primary key (aggregate_kind, aggregate_id, version)
);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create or replace function lighthouse.refuse_ledger_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name
    using errcode = 'check_violation';
end $$;

drop trigger if exists event_ledger_immutable on lighthouse.event_ledger;
create trigger event_ledger_immutable
  before update or delete on lighthouse.event_ledger
  for each row execute function lighthouse.refuse_ledger_mutation();

drop trigger if exists version_ledger_immutable on lighthouse.version_ledger;
create trigger version_ledger_immutable
  before update or delete on lighthouse.version_ledger
  for each row execute function lighthouse.refuse_ledger_mutation();

create or replace function lighthouse.guard_event_variant_update() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'event_variants rows are never deleted' using errcode = 'check_violation';
  end if;
  if new.event_id is distinct from old.event_id
     or new.event_digest is distinct from old.event_digest
     or new.role is distinct from old.role
     or new.aggregate_kind is distinct from old.aggregate_kind
     or new.aggregate_id is distinct from old.aggregate_id
     or new.version is distinct from old.version
     or new.first_received_at is distinct from old.first_received_at then
    raise exception 'event_variants identity columns are immutable' using errcode = 'check_violation';
  end if;
  if new.received_count < old.received_count then
    raise exception 'event_variants.received_count never decreases' using errcode = 'check_violation';
  end if;
  if old.resolved_outcome is not null and new.resolved_outcome is distinct from old.resolved_outcome then
    raise exception 'event_variants.resolved_outcome is set once' using errcode = 'check_violation';
  end if;
  -- The recorded outcome (and what hangs off it) is fixed, EXCEPT that a
  -- blocked variant is replaced by its re-evaluation (§3.4 step 6).
  if old.outcome <> 'blocked' and (
       new.outcome is distinct from old.outcome
       or new.conflict_kind is distinct from old.conflict_kind
       or new.quarantine_id is distinct from old.quarantine_id
       or new.alias_of_event_id is distinct from old.alias_of_event_id) then
    raise exception 'event_variants.outcome is recorded once' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists event_variants_guard on lighthouse.event_variants;
create trigger event_variants_guard
  before update or delete on lighthouse.event_variants
  for each row execute function lighthouse.guard_event_variant_update();

create or replace function lighthouse.guard_event_quarantine_update() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'event_quarantines rows are never deleted' using errcode = 'check_violation';
  end if;
  if old.state = 'resolved' then
    raise exception 'a resolved quarantine is final' using errcode = 'check_violation';
  end if;
  if new.quarantine_id is distinct from old.quarantine_id
     or new.aggregate_kind is distinct from old.aggregate_kind
     or new.aggregate_id is distinct from old.aggregate_id
     or new.version is distinct from old.version
     or new.kind is distinct from old.kind
     or new.opened_at is distinct from old.opened_at then
    raise exception 'event_quarantines identity columns are immutable' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists event_quarantines_guard on lighthouse.event_quarantines;
create trigger event_quarantines_guard
  before update or delete on lighthouse.event_quarantines
  for each row execute function lighthouse.guard_event_quarantine_update();

comment on table lighthouse.event_ledger is
  'Contract v0.3 r3 §3.2.2. eventId -> first accepted eventDigest. Immutable.';
comment on table lighthouse.event_variants is
  'Contract v0.3 r3 §3.2.2. One row per distinct (eventId, eventDigest) with its recorded outcome. Digests only, never bodies.';
comment on table lighthouse.version_ledger is
  'Contract v0.3 r3 §3.2.2. (aggregate, version) -> versionContentDigest first accepted. Immutable.';
comment on table lighthouse.event_quarantines is
  'Contract v0.3 r3 §3.4. An open row blocks its aggregate: events are refused and disclosure reads fail closed.';
comment on table lighthouse.inbound_events is
  'SUPERSEDED by event_ledger / event_variants / version_ledger (migration 0015). No longer written.';

-- ---------------------------------------------------------------------------
-- Sender outbox: durable reconciliation states (§3.4 "Sender")
-- ---------------------------------------------------------------------------
--   awaiting_reconciliation  409 blocked       kept; neither failed nor delivered
--   in_quarantine            409 conflict/422  kept; alert
--   superseded               200 superseded    terminal, logged as NOT delivered

alter table lighthouse.lifecycle_outbox
  drop constraint if exists lifecycle_outbox_state_check;
alter table lighthouse.lifecycle_outbox
  add constraint lifecycle_outbox_state_check
  check (state in ('pending','in_flight','acknowledged','failed_permanent',
                   'awaiting_reconciliation','in_quarantine','superseded'));

alter table lighthouse.lifecycle_outbox
  add column if not exists quarantine_id text,
  add column if not exists last_outcome  text,
  add column if not exists superseded_at timestamptz;

alter table lighthouse.lifecycle_outbox
  drop constraint if exists lifecycle_outbox_reconciliation_has_quarantine;
alter table lighthouse.lifecycle_outbox
  add constraint lifecycle_outbox_reconciliation_has_quarantine
  check (state not in ('awaiting_reconciliation','in_quarantine') or quarantine_id is not null);

alter table lighthouse.lifecycle_outbox
  drop constraint if exists lifecycle_outbox_superseded_has_timestamp;
alter table lighthouse.lifecycle_outbox
  add constraint lifecycle_outbox_superseded_has_timestamp
  check (state <> 'superseded' or superseded_at is not null);

-- ---------------------------------------------------------------------------
-- Lock the new tables away from browser roles
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'event_quarantines', 'event_ledger', 'event_variants', 'version_ledger'
  ] loop
    execute format('alter table lighthouse.%I enable row level security', t);
    begin
      execute format('revoke all on lighthouse.%I from anon, authenticated', t);
    exception when undefined_object then
      raise notice 'Skipping revoke on %: browser roles not present', t;
    end;
  end loop;
end $$;
