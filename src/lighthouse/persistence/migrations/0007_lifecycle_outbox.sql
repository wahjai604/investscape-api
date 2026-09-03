-- InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
--
-- Lighthouse cross-product foundation, migration 0007.
--
-- Stage 6 — durable outbox for OUTBOUND lifecycle events (InvestScape ->
-- Relationship OS). Mirrors the shape and states of `lighthouse.inbound_events`
-- (0002) and the Stage 1 result-callback outbox (callbackOutbox.ts), but for
-- arbitrary lifecycle events on any aggregate kind, not just result callbacks.
--
-- Same properties as the Stage 1 outbox: durable, idempotent retry with
-- IDENTICAL bytes, bounded exponential backoff, and a terminal state
-- (acknowledged / failed_permanent) that is never overwritten by a later
-- status.

create table if not exists lighthouse.lifecycle_outbox (
  outbox_id       text        primary key,
  aggregate_kind  text        not null,
  aggregate_id    text        not null,

  -- The full outbound LifecycleEvent shape, serialised exactly once. Retries
  -- resend these identical bytes.
  event_payload   jsonb       not null,
  payload_hash    text        not null check (payload_hash ~ '^[0-9a-f]{64}$'),

  state           text        not null default 'pending'
                    check (state in ('pending','in_flight','acknowledged','failed_permanent')),
  attempt_count   integer     not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),

  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  correlation_id  text,

  constraint lifecycle_outbox_terminal_has_timestamp
    check (state <> 'acknowledged' or acknowledged_at is not null)
);

-- One queued/acknowledged entry per (aggregate, exact payload) — identical
-- retries are idempotent no-ops rather than duplicate rows.
create unique index if not exists uq_lifecycle_outbox_aggregate_payload
  on lighthouse.lifecycle_outbox (aggregate_kind, aggregate_id, payload_hash);

create index if not exists idx_lifecycle_outbox_due
  on lighthouse.lifecycle_outbox (next_attempt_at)
  where state = 'pending';

comment on table lighthouse.lifecycle_outbox is
  'Durable outbox for outbound Stage 6 lifecycle events. Terminal states (acknowledged, failed_permanent) are never overwritten.';

-- ---------------------------------------------------------------------------
-- Lock the new table away from browser roles
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter table lighthouse.lifecycle_outbox enable row level security';
  begin
    execute 'revoke all on lighthouse.lifecycle_outbox from anon, authenticated';
  exception when undefined_object then
    raise notice 'Skipping revoke on lifecycle_outbox: browser roles not present';
  end;
end $$;
