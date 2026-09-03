/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Durable outbox for result-reference callbacks.
 *
 * Receiver prompt §6:
 *   - key: launchSessionId + externalAnalysisId + target status + payload hash
 *   - retry TRANSPORT failures with bounded exponential backoff and the
 *     IDENTICAL payload
 *   - 200 acknowledgement = success
 *   - never change a terminal complete/failed status to another status
 *   - persist the returned analysisReferenceId and acceptedAt
 *
 * Note the asymmetry with redemption: redemption must NOT retry (single-use
 * code), but callbacks MUST retry (idempotent, and Relationship OS explicitly
 * accepts identical retries). Getting these backwards either burns a client's
 * launch code or drops an analysis reference.
 */

import { createHash } from "node:crypto";
import type { ResultReference, ResultStatus } from "./contracts.ts";
import { isPermittedResultTransition } from "./contracts.ts";

export type OutboxEntryState =
  | "pending"
  | "in_flight"
  | "acknowledged"
  | "failed_permanent";

export interface OutboxEntry {
  readonly id: string;
  readonly launchSessionId: string;
  readonly externalAnalysisId: string;
  readonly targetStatus: ResultStatus;
  readonly payloadHash: string;
  /** Serialised exactly once; retries send these identical bytes. */
  readonly payload: string;
  readonly state: OutboxEntryState;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly analysisReferenceId?: string;
  readonly acceptedAt?: string;
  readonly lastError?: string;
}

/** Idempotency key, per receiver prompt §6. */
export function outboxKey(
  launchSessionId: string,
  externalAnalysisId: string,
  targetStatus: ResultStatus,
  payloadHash: string,
): string {
  return `${launchSessionId}:${externalAnalysisId}:${targetStatus}:${payloadHash}`;
}

export function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 300_000;

/**
 * Bounded exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, capped at 5 minutes.
 * Deterministic — callers add jitter if they need it.
 */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
}

export interface OutboxRepository {
  enqueue(entry: OutboxEntry): Promise<{ readonly entry: OutboxEntry; readonly created: boolean }>;
  findByKey(key: string): Promise<OutboxEntry | null>;
  latestStatusFor(launchSessionId: string, externalAnalysisId: string): Promise<ResultStatus | null>;
  update(entry: OutboxEntry): Promise<void>;
  dueEntries(now: Date, limit: number): Promise<readonly OutboxEntry[]>;
}

export type EnqueueResult =
  | { readonly ok: true; readonly entry: OutboxEntry; readonly deduplicated: boolean }
  | { readonly ok: false; readonly reason: "STATUS_REGRESSION" | "TERMINAL_ALREADY_SENT" };

/**
 * Enqueues a callback, enforcing monotonic status.
 *
 * Rejects before anything is persisted, so a regression cannot even be recorded
 * as pending — Relationship OS would answer 409 and we would be holding an
 * entry that can never succeed.
 */
export async function enqueueResultCallback(
  reference: ResultReference,
  repository: OutboxRepository,
  deps: { readonly now: () => Date; readonly newId: () => string },
): Promise<EnqueueResult> {
  const current = await repository.latestStatusFor(
    reference.launchSessionId,
    reference.externalAnalysisId,
  );

  if (!isPermittedResultTransition(current, reference.status)) {
    return {
      ok: false,
      reason: current !== null && current !== reference.status
        ? "TERMINAL_ALREADY_SENT"
        : "STATUS_REGRESSION",
    };
  }

  const payload = JSON.stringify(reference);
  const payloadHash = hashPayload(payload);
  const key = outboxKey(
    reference.launchSessionId,
    reference.externalAnalysisId,
    reference.status,
    payloadHash,
  );

  const existing = await repository.findByKey(key);
  if (existing) {
    // Identical payload already queued or acknowledged — idempotent no-op.
    return { ok: true, entry: existing, deduplicated: true };
  }

  const entry: OutboxEntry = {
    id: deps.newId(),
    launchSessionId: reference.launchSessionId,
    externalAnalysisId: reference.externalAnalysisId,
    targetStatus: reference.status,
    payloadHash,
    payload,
    state: "pending",
    attempts: 0,
    nextAttemptAt: deps.now().toISOString(),
  };

  const result = await repository.enqueue(entry);
  return { ok: true, entry: result.entry, deduplicated: !result.created };
}

export type DeliveryOutcome =
  | { readonly kind: "acknowledged"; readonly analysisReferenceId?: string; readonly acceptedAt?: string }
  /** Transport/5xx — safe to retry with identical bytes. */
  | { readonly kind: "retryable"; readonly reason: string }
  /** 4xx other than 409 — retrying cannot help. */
  | { readonly kind: "permanent"; readonly reason: string };

/**
 * Applies a delivery outcome, returning the updated entry.
 *
 * A 409 from Relationship OS means it already holds this reference (or a
 * conflicting one). Either way resending is pointless, so it terminates rather
 * than consuming the retry budget.
 */
export function applyDeliveryOutcome(
  entry: OutboxEntry,
  outcome: DeliveryOutcome,
  now: Date,
): OutboxEntry {
  if (outcome.kind === "acknowledged") {
    return {
      ...entry,
      state: "acknowledged",
      attempts: entry.attempts + 1,
      analysisReferenceId: outcome.analysisReferenceId,
      acceptedAt: outcome.acceptedAt ?? now.toISOString(),
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

/** Maps an HTTP response to a delivery outcome. */
export function classifyResponse(status: number): DeliveryOutcome {
  if (status === 200) return { kind: "acknowledged" };
  if (status === 409) return { kind: "permanent", reason: "conflict_409" };
  if (status >= 500) return { kind: "retryable", reason: `server_${status}` };
  if (status === 429) return { kind: "retryable", reason: "rate_limited" };
  if (status >= 400) return { kind: "permanent", reason: `client_${status}` };
  return { kind: "retryable", reason: `unexpected_${status}` };
}

/** In-memory outbox for tests and local development. */
export class InMemoryOutboxRepository implements OutboxRepository {
  readonly #byKey = new Map<string, OutboxEntry>();
  readonly #byId = new Map<string, OutboxEntry>();

  #keyOf(entry: OutboxEntry): string {
    return outboxKey(
      entry.launchSessionId, entry.externalAnalysisId,
      entry.targetStatus, entry.payloadHash,
    );
  }

  async enqueue(entry: OutboxEntry) {
    const key = this.#keyOf(entry);
    const existing = this.#byKey.get(key);
    if (existing) return { entry: existing, created: false };
    this.#byKey.set(key, entry);
    this.#byId.set(entry.id, entry);
    return { entry, created: true };
  }

  async findByKey(key: string): Promise<OutboxEntry | null> {
    return this.#byKey.get(key) ?? null;
  }

  async latestStatusFor(
    launchSessionId: string,
    externalAnalysisId: string,
  ): Promise<ResultStatus | null> {
    let latest: ResultStatus | null = null;
    for (const entry of this.#byKey.values()) {
      if (
        entry.launchSessionId !== launchSessionId ||
        entry.externalAnalysisId !== externalAnalysisId
      ) continue;
      // Terminal wins: a newer terminal state must not be overwritten by an
      // older active one (invariant: monotonic under out-of-order delivery).
      if (entry.targetStatus !== "draft") return entry.targetStatus;
      latest = entry.targetStatus;
    }
    return latest;
  }

  async update(entry: OutboxEntry): Promise<void> {
    this.#byKey.set(this.#keyOf(entry), entry);
    this.#byId.set(entry.id, entry);
  }

  async dueEntries(now: Date, limit: number): Promise<readonly OutboxEntry[]> {
    return [...this.#byKey.values()]
      .filter((e) => e.state === "pending" && new Date(e.nextAttemptAt) <= now)
      .slice(0, limit);
  }

  get all(): readonly OutboxEntry[] {
    return [...this.#byKey.values()];
  }
}
