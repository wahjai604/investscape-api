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
 *   - success = a 200 whose event-ack passes `validateEventAck` against the
 *     submitted event; a bare or mismatched 200 is NOT delivery
 *   - a terminal state (acknowledged / failed_permanent / superseded) is NEVER
 *     changed to another status
 *
 * RECONCILIATION STATES (contract v0.3 r3 §3.4 "Sender"), read from the
 * receiver's `lighthouse.event-ack.v1` body:
 *   - 409 blocked                  -> awaiting_reconciliation
 *   - 409 conflict / 422 rejected  -> in_quarantine
 *   - 200 superseded               -> superseded (terminal, NOT delivered)
 * Neither awaiting_reconciliation nor in_quarantine is failed or delivered;
 * the entry and its bytes are kept durably. The resubmission schedule is
 * DECISION REQUIRED (D7b), so nothing here reschedules them: the sweep only
 * picks up `pending` entries, and a reconciliation-state entry waits until a
 * decided policy (or an operator) moves it back to `pending`.
 */

import { createHash } from "node:crypto";

export type OutboxEntryState =
  | "pending"
  | "in_flight"
  | "acknowledged"
  | "failed_permanent"
  | "awaiting_reconciliation"
  | "in_quarantine"
  | "superseded";

const TERMINAL_STATES: readonly OutboxEntryState[] = ["acknowledged", "failed_permanent", "superseded"];

export function isTerminalOutboxState(state: OutboxEntryState): boolean {
  return TERMINAL_STATES.includes(state);
}

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
  /** Set while awaiting_reconciliation / in_quarantine. */
  readonly quarantineId?: string;
  /** The receiver's last `outcome`, when it sent an event-ack. */
  readonly lastOutcome?: string;
  readonly supersededAt?: string;
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
  | { readonly kind: "acknowledged"; readonly outcome?: string }
  /** 200 superseded: terminal, but the event was NOT delivered. */
  | { readonly kind: "superseded" }
  /** 409 blocked: the receiver discarded the body; keep it and resubmit later. */
  | { readonly kind: "awaiting_reconciliation"; readonly quarantineId: string }
  /** 409 conflict / 422 rejected_transition: an open quarantine names this event. */
  | { readonly kind: "in_quarantine"; readonly quarantineId: string; readonly outcome: string }
  /** Transport/5xx — safe to retry with identical bytes. */
  | { readonly kind: "retryable"; readonly reason: string }
  /** 4xx other than 409/429 — retrying cannot help. */
  | { readonly kind: "permanent"; readonly reason: string };

/** The identity of the event actually sent, which every ack must echo. */
export interface SubmittedEventIdentity {
  readonly eventId: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly version: number;
}

/**
 * Reads the identity back out of the stored bytes and checks it against the
 * entry's own columns. Null when the bytes cannot be matched to an ack at all;
 * such an entry must never be sent, because no answer could acknowledge it.
 */
export function submittedIdentity(entry: LifecycleOutboxEntry): SubmittedEventIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const event = parsed as Record<string, unknown>;
  if (typeof event.eventId !== "string" || event.eventId.length === 0) return null;
  if (typeof event.version !== "number" || !Number.isInteger(event.version) || event.version < 1) return null;
  if ("aggregateKind" in event && event.aggregateKind !== entry.aggregateKind) return null;
  if ("aggregateId" in event && event.aggregateId !== entry.aggregateId) return null;
  return {
    eventId: event.eventId,
    aggregateKind: entry.aggregateKind,
    aggregateId: entry.aggregateId,
    version: event.version,
  };
}

const OUTCOMES_BY_STATUS: Readonly<Record<number, readonly string[]>> = {
  200: ["applied", "applied_with_gap", "duplicate", "stale", "superseded"],
  409: ["conflict", "blocked"],
  422: ["rejected_transition"],
};
const ALL_OUTCOMES = Object.values(OUTCOMES_BY_STATUS).flat();
/** What a replayed `duplicate` / `superseded` may say the first delivery produced. */
const ORIGINAL_OUTCOMES: Readonly<Record<string, readonly string[]>> = {
  duplicate: ["applied", "applied_with_gap", "duplicate", "stale"],
  superseded: ["conflict", "rejected_transition"],
};
const CONFLICT_KINDS = ["EVENT_ID_DIGEST_MISMATCH", "AGGREGATE_VERSION_CONTENT_MISMATCH"];
const QUARANTINE_OUTCOMES = ["conflict", "blocked", "rejected_transition"];
const ACK_KEYS = new Set([
  "schemaVersion", "eventId", "aggregateKind", "aggregateId", "version", "outcome",
  "originalOutcome", "conflictKind", "quarantineId", "storedVersion", "receivedAt",
]);

export type AckValidation =
  | {
      readonly ok: true;
      readonly outcome: string;
      readonly quarantineId?: string;
    }
  | { readonly ok: false; readonly reason: string };

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256;

/**
 * Checks a `lighthouse.event-ack.v1` body against the event that was sent and
 * the HTTP status it arrived with (contract v0.3 r3 §3.3). An ack that is
 * empty, malformed, about a different event, or that contradicts its own
 * status or fields is NOT an answer about this event, whatever the status.
 */
export function validateEventAck(
  status: number,
  body: unknown,
  submitted: SubmittedEventIdentity,
): AckValidation {
  const fail = (reason: string): AckValidation => ({ ok: false, reason });
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fail("ack_missing");
  const ack = body as Record<string, unknown>;
  for (const key of Object.keys(ack)) if (!ACK_KEYS.has(key)) return fail("ack_unknown_field");

  if (ack.schemaVersion !== "lighthouse.event-ack.v1") return fail("ack_schema");
  if (ack.eventId !== submitted.eventId) return fail("ack_event_id_mismatch");
  if (ack.aggregateKind !== submitted.aggregateKind || ack.aggregateId !== submitted.aggregateId) {
    return fail("ack_aggregate_mismatch");
  }
  if (ack.version !== submitted.version) return fail("ack_version_mismatch");

  const outcome = ack.outcome;
  if (typeof outcome !== "string" || !ALL_OUTCOMES.includes(outcome)) return fail("ack_outcome_unknown");
  if (!(OUTCOMES_BY_STATUS[status] ?? []).includes(outcome)) return fail("ack_status_contradiction");

  if (ack.storedVersion !== null && !(Number.isInteger(ack.storedVersion) && (ack.storedVersion as number) >= 0)) {
    return fail("ack_stored_version");
  }
  if (typeof ack.receivedAt !== "string" || Number.isNaN(Date.parse(ack.receivedAt))) return fail("ack_received_at");

  if ("originalOutcome" in ack) {
    const allowed = ORIGINAL_OUTCOMES[outcome];
    if (!allowed || !allowed.includes(ack.originalOutcome as string)) return fail("ack_original_outcome_contradiction");
  }
  if (outcome === "conflict") {
    if (!CONFLICT_KINDS.includes(ack.conflictKind as string)) return fail("ack_conflict_kind");
  } else if ("conflictKind" in ack) {
    return fail("ack_conflict_kind_contradiction");
  }
  if (QUARANTINE_OUTCOMES.includes(outcome)) {
    if (!isNonEmptyString(ack.quarantineId)) return fail("ack_quarantine_id_missing");
    return { ok: true, outcome, quarantineId: ack.quarantineId };
  }
  if ("quarantineId" in ack) return fail("ack_quarantine_id_contradiction");
  return { ok: true, outcome };
}

/**
 * Maps an HTTP response (status and the parsed body, if any) to a delivery
 * outcome for the SUBMITTED event. Only a valid 200 ack with applied /
 * applied_with_gap / duplicate / stale delivers; a valid 200 superseded is
 * terminal but not delivered. Never marks delivered on conflict, blocked or
 * rejected_transition, and never on an ack that fails `validateEventAck`.
 */
export function classifyResponse(
  status: number,
  body: unknown,
  submitted: SubmittedEventIdentity,
): DeliveryOutcome {
  if (status === 200 || status === 409 || status === 422) {
    const ack = validateEventAck(status, body, submitted);
    if (ack.ok) {
      if (ack.outcome === "superseded") return { kind: "superseded" };
      if (ack.outcome === "blocked") return { kind: "awaiting_reconciliation", quarantineId: ack.quarantineId! };
      if (ack.outcome === "conflict" || ack.outcome === "rejected_transition") {
        return { kind: "in_quarantine", quarantineId: ack.quarantineId!, outcome: ack.outcome };
      }
      return { kind: "acknowledged", outcome: ack.outcome };
    }
    // A 200 without a valid ack is not an answer: resend the identical bytes,
    // which the receiver answers from its ledger. Bounded by MAX_ATTEMPTS.
    if (status === 200) return { kind: "retryable", reason: `invalid_ack:${ack.reason}` };
    return { kind: "permanent", reason: `client_${status}:${ack.reason}` };
  }
  if (status >= 500) return { kind: "retryable", reason: `server_${status}` };
  if (status === 429) return { kind: "retryable", reason: "rate_limited" };
  if (status >= 400) return { kind: "permanent", reason: `client_${status}` };
  return { kind: "retryable", reason: `unexpected_${status}` };
}

/**
 * Applies a delivery outcome, returning the updated entry.
 *
 * A terminal state (`acknowledged` / `failed_permanent` / `superseded`) is
 * never changed to another status. A reconciliation state is not terminal: a
 * later resubmission's response moves it on.
 */
export function applyDeliveryOutcome(
  entry: LifecycleOutboxEntry,
  outcome: DeliveryOutcome,
  now: Date,
): LifecycleOutboxEntry {
  if (isTerminalOutboxState(entry.state)) {
    return entry;
  }

  if (outcome.kind === "acknowledged") {
    return {
      ...entry,
      state: "acknowledged",
      attempts: entry.attempts + 1,
      acknowledgedAt: now.toISOString(),
      lastError: undefined,
      quarantineId: undefined,
      lastOutcome: outcome.outcome,
    };
  }

  if (outcome.kind === "superseded") {
    return {
      ...entry,
      state: "superseded",
      attempts: entry.attempts + 1,
      supersededAt: now.toISOString(),
      lastOutcome: "superseded",
      lastError: undefined,
    };
  }

  // Not a failure: the retry budget is for transport faults, and these
  // entries must survive however long reconciliation takes.
  if (outcome.kind === "awaiting_reconciliation") {
    return {
      ...entry,
      state: "awaiting_reconciliation",
      attempts: entry.attempts + 1,
      quarantineId: outcome.quarantineId,
      lastOutcome: "blocked",
      lastError: undefined,
    };
  }

  if (outcome.kind === "in_quarantine") {
    return {
      ...entry,
      state: "in_quarantine",
      attempts: entry.attempts + 1,
      quarantineId: outcome.quarantineId,
      lastOutcome: outcome.outcome,
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
      quarantineId: row.quarantine_id ? String(row.quarantine_id) : undefined,
      lastOutcome: row.last_outcome ? String(row.last_outcome) : undefined,
      supersededAt: row.superseded_at
        ? new Date(row.superseded_at as string).toISOString()
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
                 state, attempt_count, next_attempt_at, correlation_id, acknowledged_at,
              quarantine_id, last_outcome, superseded_at`,
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
              state, attempt_count, next_attempt_at, correlation_id, acknowledged_at,
              quarantine_id, last_outcome, superseded_at
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
          set state = $2, attempt_count = $3, next_attempt_at = $4, acknowledged_at = $5,
              quarantine_id = $6, last_outcome = $7, superseded_at = $8
        where outbox_id = $1
          and state not in ('acknowledged','failed_permanent','superseded')`,
      [
        entry.id, entry.state, entry.attempts, entry.nextAttemptAt, entry.acknowledgedAt ?? null,
        entry.quarantineId ?? null, entry.lastOutcome ?? null, entry.supersededAt ?? null,
      ],
    );
  }

  async dueEntries(now: Date, limit: number): Promise<readonly LifecycleOutboxEntry[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select outbox_id, aggregate_kind, aggregate_id, event_payload, payload_hash,
              state, attempt_count, next_attempt_at, correlation_id, acknowledged_at,
              quarantine_id, last_outcome, superseded_at
         from lighthouse.lifecycle_outbox
        where state = 'pending' and next_attempt_at <= $1
        order by next_attempt_at asc
        limit $2`,
      [now.toISOString(), limit],
    );
    return result.rows.map((row) => this.#fromRow(row));
  }
}
