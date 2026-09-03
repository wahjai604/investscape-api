/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Durable outbox for OUTBOUND lifecycle events — the general form of Stage 1's
 * `callbackOutbox.ts` (read that file first; this generalizes "result callbacks
 * only" to "any lifecycle event for any aggregate kind").
 *
 * Same properties, same reasoning:
 *   - idempotent enqueue keyed on (aggregateKind, aggregateId, payloadHash) —
 *     an identical retry is a no-op, not a duplicate row
 *   - retry TRANSPORT failures with bounded exponential backoff and IDENTICAL
 *     bytes (never re-serialise; the signed bytes must match the sent bytes)
 *   - 200 acknowledgement = success
 *   - a terminal state (acknowledged / failed_permanent) is NEVER changed to
 *     another status
 */

import { createHash } from "node:crypto";

export type OutboxEntryState = "pending" | "in_flight" | "acknowledged" | "failed_permanent";

export interface LifecycleOutboxEntry {
  readonly id: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly payloadHash: string;
  /** Serialised exactly once; retries send these identical bytes. */
  readonly payload: string;
  readonly state: OutboxEntryState;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly correlationId?: string;
  readonly acknowledgedAt?: string;
  readonly lastError?: string;
}

export function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 300_000;

/** Bounded exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, capped at 5 minutes. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
}

export interface LifecycleOutboxRepository {
  enqueue(
    entry: LifecycleOutboxEntry,
  ): Promise<{ readonly entry: LifecycleOutboxEntry; readonly created: boolean }>;
  findByAggregateAndHash(
    aggregateKind: string,
    aggregateId: string,
    payloadHash: string,
  ): Promise<LifecycleOutboxEntry | null>;
  update(entry: LifecycleOutboxEntry): Promise<void>;
  dueEntries(now: Date, limit: number): Promise<readonly LifecycleOutboxEntry[]>;
}

export interface EnqueueOutboundEventInput {
  readonly aggregateKind: string;
  readonly aggregateId: string;
  /** The full outbound lifecycle event payload (already shaped for the wire). */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

/**
 * Enqueues an outbound lifecycle event.
 *
 * This is the seam other stages COULD call when their own aggregate's
 * lifecycle changes (e.g. a Stage 4 share-grant revocation). Wiring those call
 * sites into stage2/4/7/8 is explicitly NOT done here — those files are owned
 * by concurrently-developed changes. This function is the clean surface a
 * future integration pass calls into.
 */
export async function enqueueOutboundEvent(
  input: EnqueueOutboundEventInput,
  repository: LifecycleOutboxRepository,
  deps: { readonly now: () => Date; readonly newId: () => string },
): Promise<{ readonly entry: LifecycleOutboxEntry; readonly deduplicated: boolean }> {
  const payload = JSON.stringify(input.payload);
  const payloadHash = hashPayload(payload);

  const existing = await repository.findByAggregateAndHash(
    input.aggregateKind,
    input.aggregateId,
    payloadHash,
  );
  if (existing) {
    return { entry: existing, deduplicated: true };
  }

  const entry: LifecycleOutboxEntry = {
    id: deps.newId(),
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    payloadHash,
    payload,
    state: "pending",
    attempts: 0,
    nextAttemptAt: deps.now().toISOString(),
    correlationId: input.correlationId,
  };

  const result = await repository.enqueue(entry);
  return { entry: result.entry, deduplicated: !result.created };
}

export type DeliveryOutcome =
  | { readonly kind: "acknowledged" }
  /** Transport/5xx — safe to retry with identical bytes. */
  | { readonly kind: "retryable"; readonly reason: string }
  /** 4xx other than 409/429 — retrying cannot help. */
  | { readonly kind: "permanent"; readonly reason: string };

/** Maps an HTTP response status to a delivery outcome. */
export function classifyResponse(status: number): DeliveryOutcome {
  if (status === 200) return { kind: "acknowledged" };
  if (status === 409) return { kind: "permanent", reason: "conflict_409" };
  if (status >= 500) return { kind: "retryable", reason: `server_${status}` };
  if (status === 429) return { kind: "retryable", reason: "rate_limited" };
  if (status >= 400) return { kind: "permanent", reason: `client_${status}` };
  return { kind: "retryable", reason: `unexpected_${status}` };
}

/**
 * Applies a delivery outcome, returning the updated entry.
 *
 * A terminal state (`acknowledged` / `failed_permanent`) is never changed to
 * another status — the caller must not invoke this again on an entry already
 * in a terminal state.
 */
export function applyDeliveryOutcome(
  entry: LifecycleOutboxEntry,
  outcome: DeliveryOutcome,
  now: Date,
): LifecycleOutboxEntry {
  if (entry.state === "acknowledged" || entry.state === "failed_permanent") {
    return entry;
  }

  if (outcome.kind === "acknowledged") {
    return {
      ...entry,
      state: "acknowledged",
      attempts: entry.attempts + 1,
      acknowledgedAt: now.toISOString(),
      lastError: undefined,
    };
  }

  if (outcome.kind === "permanent") {
    return {
      ...entry,
      state: "failed_permanent",
      attempts: entry.attempts + 1,
      lastError: outcome.reason,
    };
  }

  const attempts = entry.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return {
      ...entry,
      state: "failed_permanent",
      attempts,
      lastError: `retry_budget_exhausted:${outcome.reason}`,
    };
  }

  return {
    ...entry,
    state: "pending",
    attempts,
    nextAttemptAt: new Date(now.getTime() + backoffDelayMs(attempts)).toISOString(),
    lastError: outcome.reason,
  };
}

/** In-memory outbox for tests and local development. */
export class InMemoryLifecycleOutboxRepository implements LifecycleOutboxRepository {
  readonly #byKey = new Map<string, LifecycleOutboxEntry>();
  readonly #byId = new Map<string, LifecycleOutboxEntry>();

  #keyOf(entry: LifecycleOutboxEntry): string {
    return `${entry.aggregateKind}:${entry.aggregateId}:${entry.payloadHash}`;
  }

  async enqueue(entry: LifecycleOutboxEntry) {
    const key = this.#keyOf(entry);
    const existing = this.#byKey.get(key);
    if (existing) return { entry: existing, created: false };
    this.#byKey.set(key, entry);
    this.#byId.set(entry.id, entry);
    return { entry, created: true };
  }

  async findByAggregateAndHash(
    aggregateKind: string,
    aggregateId: string,
    payloadHash: string,
  ): Promise<LifecycleOutboxEntry | null> {
    return this.#byKey.get(`${aggregateKind}:${aggregateId}:${payloadHash}`) ?? null;
  }

  async update(entry: LifecycleOutboxEntry): Promise<void> {
    this.#byKey.set(this.#keyOf(entry), entry);
    this.#byId.set(entry.id, entry);
  }

  async dueEntries(now: Date, limit: number): Promise<readonly LifecycleOutboxEntry[]> {
    return [...this.#byKey.values()]
      .filter((e) => e.state === "pending" && new Date(e.nextAttemptAt) <= now)
      .slice(0, limit);
  }

  get all(): readonly LifecycleOutboxEntry[] {
    return [...this.#byKey.values()];
  }
}

/** Postgres-backed outbox against `lighthouse.lifecycle_outbox` (migration 0007). */
export class SqlLifecycleOutboxRepository implements LifecycleOutboxRepository {
  readonly #client: import("../persistence/types.ts").SqlClient;

  constructor(client: import("../persistence/types.ts").SqlClient) {
    this.#client = client;
  }

  #fromRow(row: Record<string, unknown>): LifecycleOutboxEntry {
    return {
      id: String(row.outbox_id),
      aggregateKind: String(row.aggregate_kind),
      aggregateId: String(row.aggregate_id),
      payload: JSON.stringify(row.event_payload),
      payloadHash: String(row.payload_hash),
      state: row.state as OutboxEntryState,
      attempts: Number(row.attempt_count),
      nextAttemptAt: new Date(row.next_attempt_at as string).toISOString(),
      correlationId: row.correlation_id ? String(row.correlation_id) : undefined,
      acknowledgedAt: row.acknowledged_at
        ? new Date(row.acknowledged_at as string).toISOString()
        : undefined,
    };
  }

  async enqueue(entry: LifecycleOutboxEntry) {
    const result = await this.#client.query<Record<string, unknown>>(
      `insert into lighthouse.lifecycle_outbox
         (outbox_id, aggregate_kind, aggregate_id, event_payload, payload_hash,
          state, attempt_count, next_attempt_at, correlation_id)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
       on conflict (aggregate_kind, aggregate_id, payload_hash) do nothing
       returning outbox_id, aggregate_kind, aggregate_id, event_payload, payload_hash,
                 state, attempt_count, next_attempt_at, correlation_id, acknowledged_at`,
      [
        entry.id, entry.aggregateKind, entry.aggregateId, entry.payload,
        entry.payloadHash, entry.state, entry.attempts, entry.nextAttemptAt,
        entry.correlationId ?? null,
      ],
    );
    if (result.rowCount === 1 && result.rows[0]) {
      return { entry: this.#fromRow(result.rows[0]), created: true };
    }
    const existing = await this.findByAggregateAndHash(
      entry.aggregateKind, entry.aggregateId, entry.payloadHash,
    );
    return { entry: existing ?? entry, created: false };
  }

  async findByAggregateAndHash(
    aggregateKind: string,
    aggregateId: string,
    payloadHash: string,
  ): Promise<LifecycleOutboxEntry | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select outbox_id, aggregate_kind, aggregate_id, event_payload, payload_hash,
              state, attempt_count, next_attempt_at, correlation_id, acknowledged_at
         from lighthouse.lifecycle_outbox
        where aggregate_kind = $1 and aggregate_id = $2 and payload_hash = $3`,
      [aggregateKind, aggregateId, payloadHash],
    );
    const row = result.rows[0];
    return row ? this.#fromRow(row) : null;
  }

  async update(entry: LifecycleOutboxEntry): Promise<void> {
    await this.#client.query(
      `update lighthouse.lifecycle_outbox
          set state = $2, attempt_count = $3, next_attempt_at = $4, acknowledged_at = $5
        where outbox_id = $1`,
      [entry.id, entry.state, entry.attempts, entry.nextAttemptAt, entry.acknowledgedAt ?? null],
    );
  }

  async dueEntries(now: Date, limit: number): Promise<readonly LifecycleOutboxEntry[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select outbox_id, aggregate_kind, aggregate_id, event_payload, payload_hash,
              state, attempt_count, next_attempt_at, correlation_id, acknowledged_at
         from lighthouse.lifecycle_outbox
        where state = 'pending' and next_attempt_at <= $1
        order by next_attempt_at asc
        limit $2`,
      [now.toISOString(), limit],
    );
    return result.rows.map((row) => this.#fromRow(row));
  }
}
