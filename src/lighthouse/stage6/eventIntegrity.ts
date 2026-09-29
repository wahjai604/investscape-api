/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 — inbound event integrity, contract v0.3 r3 §3.2–§3.4
 * (commit 559fee8a727d3b5a4ef92ddeb79c6b5dc800cdb6).
 *
 * `processInboundEvent` evaluates §3.3 rules 2–11 for one event that has
 * already passed rule 1 (strict schema + recomputed `eventDigest`). Every
 * read and every write — ledger rows, the variant and its outcome, the
 * quarantine, AND the aggregate's state change (with the link → grant
 * cascade) — happens inside ONE `EventIntegrityStore.transaction`. There is
 * no committed state in which the aggregate moved but the ledger does not
 * say so, or the ledger records an outcome whose effect was rolled back.
 *
 * The transaction is serialised per `eventId` and per aggregate by the
 * store (advisory locks in Postgres; a mutex in memory), so two concurrent
 * identical arrivals apply once and two concurrent conflicting arrivals
 * are ordered: the first becomes the original, the second a conflicting
 * variant (§3.2.2). If the store nevertheless reports a unique-key race on
 * the ledger, the whole transaction is retried and re-evaluated from scratch.
 *
 * Quarantine alerts are returned to the caller, which fires them AFTER
 * commit — an alert for a rolled-back quarantine must never be sent.
 *
 * Automatic reconciliation is deliberately NOT here. `resolveQuarantine` is
 * the resolve transaction of §3.4 step 5 as a library function; nothing calls
 * it automatically, and no route exposes it. Until the authoritative recovery
 * endpoints (§5) exist, an open quarantine stays open and its aggregate stays
 * blocked.
 */

import {
  applyLifecycleEvent,
  type LifecycleDefinition,
} from "../domain/lifecycle.ts";
import { UniqueConstraintViolation } from "../persistence/types.ts";
import type { EventEnvelope } from "./eventDigest.ts";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const ACK_SCHEMA_VERSION = "lighthouse.event-ack.v1";

/** Outcomes a variant can RECORD. `superseded` is only ever a resolvedOutcome. */
export type RecordedOutcome =
  | "applied"
  | "applied_with_gap"
  | "duplicate"
  | "stale"
  | "conflict"
  | "blocked"
  | "rejected_transition";

export type AckOutcome = RecordedOutcome | "superseded";

export type ConflictKind = "EVENT_ID_DIGEST_MISMATCH" | "AGGREGATE_VERSION_CONTENT_MISMATCH";

export type QuarantineKind = ConflictKind | "REJECTED_TRANSITION";

export interface AggregateState {
  readonly state: string;
  readonly version: number;
  readonly occurredAt: string;
}

export interface EventLedgerRow {
  readonly eventId: string;
  readonly acceptedEventDigest: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly version: number;
  readonly firstReceivedAt: string;
}

export interface EventVariantRow {
  readonly eventId: string;
  readonly eventDigest: string;
  readonly role: "original" | "conflicting";
  readonly outcome: RecordedOutcome;
  readonly resolvedOutcome: "superseded" | null;
  readonly conflictKind: ConflictKind | null;
  readonly quarantineId: string | null;
  readonly aliasOfEventId: string | null;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly version: number;
  readonly receivedCount: number;
  readonly firstReceivedAt: string;
  readonly lastReceivedAt: string;
}

export interface VersionLedgerRow {
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly version: number;
  readonly versionContentDigest: string;
  readonly firstEventId: string;
  readonly recordedAt: string;
}

export interface QuarantineRow {
  readonly quarantineId: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly version: number;
  readonly kind: QuarantineKind;
  readonly state: "open" | "resolved";
  readonly openedAt: string;
  readonly resolution: "adopted_owner_state" | "operator_override" | null;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
}

/** The outcome a blocked variant is replaced with on re-evaluation. */
export interface VariantOutcomeReplacement {
  readonly outcome: RecordedOutcome;
  readonly conflictKind: ConflictKind | null;
  readonly quarantineId: string | null;
  readonly aliasOfEventId: string | null;
}

/**
 * Everything the rules need, scoped to one open transaction. Implementations
 * MUST make every method part of the same atomic unit: all of it commits or
 * none of it does.
 */
export interface EventIntegrityUnitOfWork {
  findVariant(eventId: string, eventDigest: string): Promise<EventVariantRow | null>;
  findEventLedger(eventId: string): Promise<EventLedgerRow | null>;
  /** Throws `UniqueConstraintViolation` if the eventId already exists. */
  insertEventLedger(row: EventLedgerRow): Promise<void>;
  insertVariant(row: EventVariantRow): Promise<void>;
  touchVariant(eventId: string, eventDigest: string, at: string): Promise<void>;
  replaceBlockedVariantOutcome(
    eventId: string,
    eventDigest: string,
    replacement: VariantOutcomeReplacement,
    at: string,
  ): Promise<void>;
  findVersionLedger(
    aggregateKind: string,
    aggregateId: string,
    version: number,
  ): Promise<VersionLedgerRow | null>;
  insertVersionLedger(row: VersionLedgerRow): Promise<void>;
  findOpenQuarantine(aggregateKind: string, aggregateId: string): Promise<QuarantineRow | null>;
  getQuarantine(quarantineId: string): Promise<QuarantineRow | null>;
  insertQuarantine(row: QuarantineRow): Promise<void>;
  /** Serialises against other transactions on this aggregate, when not already held. */
  lockAggregate(aggregateKind: string, aggregateId: string): Promise<void>;
  hasAggregateStore(aggregateKind: string): boolean;
  /** Reads the aggregate's lifecycle projection, locking its row for this transaction. */
  loadAggregateForUpdate(aggregateKind: string, aggregateId: string): Promise<AggregateState | null>;
  /** Reads without locking; null when unknown or no store is wired. */
  peekAggregate(aggregateKind: string, aggregateId: string): Promise<AggregateState | null>;
  /**
   * Writes a state the rules already decided. Implementations apply any
   * dependent effect (link → grant cascade) in THIS transaction.
   */
  saveAggregate(aggregateKind: string, aggregateId: string, state: AggregateState): Promise<void>;
}

export interface TransactionScope {
  readonly eventId: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
}

export interface EventIntegrityStore {
  /**
   * Runs `fn` in one atomic transaction holding the eventId lock and then the
   * aggregate lock, in that order. A throw rolls everything back.
   */
  transaction<T>(scope: TransactionScope, fn: (uow: EventIntegrityUnitOfWork) => Promise<T>): Promise<T>;
  /** Fail-closed read used by disclosure paths (§3.4 step 3). */
  isAggregateBlocked(aggregateKind: string, aggregateId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface EventAck {
  readonly schemaVersion: typeof ACK_SCHEMA_VERSION;
  readonly eventId: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly version: number;
  readonly outcome: AckOutcome;
  readonly originalOutcome?: RecordedOutcome;
  readonly conflictKind?: ConflictKind;
  readonly quarantineId?: string;
  readonly storedVersion: number | null;
  readonly receivedAt: string;
}

export interface QuarantineAlert {
  readonly quarantineId: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly version: number;
  readonly kind: QuarantineKind;
  readonly eventId: string;
  readonly eventDigest: string;
  /** false when the variant joined an already-open quarantine. */
  readonly opened: boolean;
}

export type ProcessResult =
  | {
      readonly kind: "ack";
      readonly httpStatus: 200 | 409 | 422;
      readonly ack: EventAck;
      /** true when this call ran rules 4–11 and changed the aggregate. */
      readonly applied: boolean;
      readonly invalidatesAccess: boolean;
      /** true when the response was answered from a recorded variant (rule 2). */
      readonly replayed: boolean;
      readonly quarantineAlert: QuarantineAlert | null;
    }
  /** No aggregate store is wired for this kind. Nothing was recorded. */
  | { readonly kind: "store_not_configured" }
  /** The store is wired but holds no row for this aggregate. Nothing was recorded. */
  | { readonly kind: "aggregate_not_found" };

export interface ProcessDependencies {
  readonly store: EventIntegrityStore;
  readonly definitionFor: (aggregateKind: string) => LifecycleDefinition<string> | null;
  readonly now: () => Date;
  readonly newQuarantineId: () => string;
}

export interface VerifiedEvent {
  readonly envelope: EventEnvelope;
  /** The RECOMPUTED digest, already compared with the sent one (rule 1). */
  readonly eventDigest: string;
  readonly versionContentDigest: string;
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

class StoreNotConfigured extends Error {}
class AggregateNotFound extends Error {}

const MAX_ATTEMPTS = 3;

/** SQLSTATE 40P01 deadlock_detected, 40001 serialization_failure. */
function isRetryable(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolation) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return code === "40P01" || code === "40001";
}

export async function processInboundEvent(
  event: VerifiedEvent,
  deps: ProcessDependencies,
): Promise<ProcessResult> {
  const scope: TransactionScope = {
    eventId: event.envelope.eventId,
    aggregateKind: event.envelope.aggregateKind,
    aggregateId: event.envelope.aggregateId,
  };
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await deps.store.transaction(scope, (uow) => evaluate(uow, event, deps));
    } catch (error) {
      if (error instanceof StoreNotConfigured) return { kind: "store_not_configured" };
      if (error instanceof AggregateNotFound) return { kind: "aggregate_not_found" };
      // Two first arrivals raced on a ledger key: the loser rolled back and is
      // re-evaluated, finding the winner's row (§3.2.2). A deadlock between two
      // cross-aggregate conflicts is resolved by Postgres rolling one back;
      // that one is simply evaluated again.
      if (isRetryable(error) && attempt < MAX_ATTEMPTS) continue;
      throw error;
    }
  }
}

interface RuleDecision {
  readonly outcome: RecordedOutcome;
  readonly conflictKind: ConflictKind | null;
  readonly quarantine: { readonly row: QuarantineRow; readonly opened: boolean } | null;
  readonly aliasOfEventId: string | null;
  readonly applied: boolean;
  readonly invalidatesAccess: boolean;
  readonly storedVersion: number | null;
}

async function evaluate(
  uow: EventIntegrityUnitOfWork,
  event: VerifiedEvent,
  deps: ProcessDependencies,
): Promise<ProcessResult> {
  const { envelope, eventDigest } = event;
  const receivedAt = deps.now().toISOString();

  // Rule 2 — these exact bytes were seen before: replay THEIR outcome.
  const variant = await uow.findVariant(envelope.eventId, eventDigest);
  if (variant) {
    return replay(uow, event, variant, deps, receivedAt);
  }

  // Rule 3 — known eventId, new bytes: a conflicting variant.
  const ledger = await uow.findEventLedger(envelope.eventId);
  if (ledger) {
    // The quarantine belongs to the aggregate the eventId was first accepted
    // for; that may not be the one this variant claims.
    await uow.lockAggregate(ledger.aggregateKind, ledger.aggregateId);
    const quarantine = await joinOrOpenQuarantine(
      uow, ledger.aggregateKind, ledger.aggregateId, ledger.version,
      "EVENT_ID_DIGEST_MISMATCH", receivedAt, deps,
    );
    await uow.insertVariant({
      eventId: envelope.eventId,
      eventDigest,
      role: "conflicting",
      outcome: "conflict",
      resolvedOutcome: null,
      conflictKind: "EVENT_ID_DIGEST_MISMATCH",
      quarantineId: quarantine.row.quarantineId,
      aliasOfEventId: null,
      aggregateKind: envelope.aggregateKind,
      aggregateId: envelope.aggregateId,
      version: envelope.version,
      receivedCount: 1,
      firstReceivedAt: receivedAt,
      lastReceivedAt: receivedAt,
    });
    return ackResult(event, receivedAt, {
      outcome: "conflict",
      conflictKind: "EVENT_ID_DIGEST_MISMATCH",
      quarantine,
      aliasOfEventId: null,
      applied: false,
      invalidatesAccess: false,
      storedVersion: (await uow.peekAggregate(envelope.aggregateKind, envelope.aggregateId))?.version ?? null,
    });
  }

  // A new eventId. Claim it first, so a concurrent first arrival of the same
  // eventId fails here and is re-evaluated as rule 2 or 3.
  await uow.insertEventLedger({
    eventId: envelope.eventId,
    acceptedEventDigest: eventDigest,
    aggregateKind: envelope.aggregateKind,
    aggregateId: envelope.aggregateId,
    version: envelope.version,
    firstReceivedAt: receivedAt,
  });
  const decision = await applyRules4To11(uow, event, deps, receivedAt);
  await uow.insertVariant({
    eventId: envelope.eventId,
    eventDigest,
    role: "original",
    outcome: decision.outcome,
    resolvedOutcome: null,
    conflictKind: decision.conflictKind,
    quarantineId: decision.quarantine?.row.quarantineId ?? null,
    aliasOfEventId: decision.aliasOfEventId,
    aggregateKind: envelope.aggregateKind,
    aggregateId: envelope.aggregateId,
    version: envelope.version,
    receivedCount: 1,
    firstReceivedAt: receivedAt,
    lastReceivedAt: receivedAt,
  });
  return ackResult(event, receivedAt, decision);
}

async function replay(
  uow: EventIntegrityUnitOfWork,
  event: VerifiedEvent,
  variant: EventVariantRow,
  deps: ProcessDependencies,
  receivedAt: string,
): Promise<ProcessResult> {
  const { envelope, eventDigest } = event;
  const quarantine = variant.quarantineId ? await uow.getQuarantine(variant.quarantineId) : null;

  // §3.4 step 6: a blocked variant whose quarantine is resolved is
  // re-evaluated through rules 4–11, and its outcome REPLACED atomically.
  if (variant.outcome === "blocked" && quarantine?.state === "resolved") {
    const decision = await applyRules4To11(uow, event, deps, receivedAt);
    await uow.replaceBlockedVariantOutcome(envelope.eventId, eventDigest, {
      outcome: decision.outcome,
      conflictKind: decision.conflictKind,
      quarantineId: decision.quarantine?.row.quarantineId ?? null,
      aliasOfEventId: decision.aliasOfEventId,
    }, receivedAt);
    return ackResult(event, receivedAt, decision);
  }

  await uow.touchVariant(envelope.eventId, eventDigest, receivedAt);
  const storedVersion = (await uow.peekAggregate(variant.aggregateKind, variant.aggregateId))?.version ?? null;
  const base = {
    schemaVersion: ACK_SCHEMA_VERSION,
    eventId: variant.eventId,
    aggregateKind: variant.aggregateKind,
    aggregateId: variant.aggregateId,
    version: variant.version,
    storedVersion,
    receivedAt,
  } as const;
  const replayed = (httpStatus: 200 | 409 | 422, ack: EventAck): ProcessResult => ({
    kind: "ack", httpStatus, ack, applied: false, invalidatesAccess: false,
    replayed: true, quarantineAlert: null,
  });

  switch (variant.outcome) {
    case "applied":
    case "applied_with_gap":
    case "duplicate":
    case "stale":
      return replayed(200, { ...base, outcome: "duplicate", originalOutcome: variant.outcome });
    case "conflict":
    case "rejected_transition":
      // An open issue is NEVER downgraded to duplicate.
      if (quarantine?.state === "open" || !quarantine) {
        return replayed(variant.outcome === "conflict" ? 409 : 422, {
          ...base,
          outcome: variant.outcome,
          ...(variant.conflictKind ? { conflictKind: variant.conflictKind } : {}),
          ...(variant.quarantineId ? { quarantineId: variant.quarantineId } : {}),
        });
      }
      return replayed(200, { ...base, outcome: "superseded", originalOutcome: variant.outcome });
    case "blocked":
      return replayed(409, {
        ...base,
        outcome: "blocked",
        ...(variant.quarantineId ? { quarantineId: variant.quarantineId } : {}),
      });
  }
}

/** §3.3 rules 4–11 for this event's own aggregate. Records nothing about the event itself. */
async function applyRules4To11(
  uow: EventIntegrityUnitOfWork,
  event: VerifiedEvent,
  deps: ProcessDependencies,
  receivedAt: string,
): Promise<RuleDecision> {
  const { envelope, versionContentDigest } = event;
  const { aggregateKind, aggregateId, version } = envelope;
  const definition = deps.definitionFor(aggregateKind);
  if (!definition || !uow.hasAggregateStore(aggregateKind)) throw new StoreNotConfigured();

  const none = { conflictKind: null, quarantine: null, aliasOfEventId: null, applied: false, invalidatesAccess: false };

  // Rules 4 and 5 — the version ledger decides alias vs conflict, whatever
  // the eventId or occurredAt.
  const versionRow = await uow.findVersionLedger(aggregateKind, aggregateId, version);
  if (versionRow) {
    const current = await uow.peekAggregate(aggregateKind, aggregateId);
    if (versionRow.versionContentDigest === versionContentDigest) {
      return { ...none, outcome: "duplicate", aliasOfEventId: versionRow.firstEventId, storedVersion: current?.version ?? null };
    }
    const quarantine = await joinOrOpenQuarantine(
      uow, aggregateKind, aggregateId, version, "AGGREGATE_VERSION_CONTENT_MISMATCH", receivedAt, deps,
    );
    return {
      ...none, outcome: "conflict", conflictKind: "AGGREGATE_VERSION_CONTENT_MISMATCH",
      quarantine, storedVersion: current?.version ?? null,
    };
  }

  // Rule 6 — blocked. The body is not retained; only the variant is recorded.
  const open = await uow.findOpenQuarantine(aggregateKind, aggregateId);
  if (open) {
    const current = await uow.peekAggregate(aggregateKind, aggregateId);
    return { ...none, outcome: "blocked", quarantine: { row: open, opened: false }, storedVersion: current?.version ?? null };
  }

  const current = await uow.loadAggregateForUpdate(aggregateKind, aggregateId);
  if (!current) throw new AggregateNotFound();

  // Rules 7–11 through the domain engine (version-only ordering).
  const result = applyLifecycleEvent(
    definition,
    { state: current.state, version: current.version, occurredAt: current.occurredAt, appliedEventIds: [] },
    { eventId: envelope.eventId, targetState: envelope.targetState, version, occurredAt: envelope.occurredAt },
  );

  if (result.kind === "stale" || result.kind === "duplicate") {
    return { ...none, outcome: "stale", storedVersion: current.version };
  }
  if (result.kind === "rejected" || result.kind === "conflict") {
    const quarantine = await joinOrOpenQuarantine(
      uow, aggregateKind, aggregateId, version, "REJECTED_TRANSITION", receivedAt, deps,
    );
    return { ...none, outcome: "rejected_transition", quarantine, storedVersion: current.version };
  }

  await uow.saveAggregate(aggregateKind, aggregateId, {
    state: result.snapshot.state,
    version: result.snapshot.version,
    occurredAt: result.snapshot.occurredAt,
  });
  await uow.insertVersionLedger({
    aggregateKind, aggregateId, version,
    versionContentDigest,
    firstEventId: envelope.eventId,
    recordedAt: receivedAt,
  });
  // Rule 10: a gap is applied, and recovery (§5) is the caller's concern —
  // snapshot recovery does not exist yet, so nothing is scheduled here.
  return {
    ...none,
    outcome: version > current.version + 1 ? "applied_with_gap" : "applied",
    applied: true,
    invalidatesAccess: result.invalidatesAccess,
    storedVersion: version,
  };
}

async function joinOrOpenQuarantine(
  uow: EventIntegrityUnitOfWork,
  aggregateKind: string,
  aggregateId: string,
  version: number,
  kind: QuarantineKind,
  at: string,
  deps: ProcessDependencies,
): Promise<{ readonly row: QuarantineRow; readonly opened: boolean }> {
  const open = await uow.findOpenQuarantine(aggregateKind, aggregateId);
  if (open) return { row: open, opened: false };
  const row: QuarantineRow = {
    quarantineId: deps.newQuarantineId(),
    aggregateKind, aggregateId, version, kind,
    state: "open",
    openedAt: at,
    resolution: null, resolvedBy: null, resolvedAt: null,
  };
  await uow.insertQuarantine(row);
  return { row, opened: true };
}

function ackResult(
  event: VerifiedEvent,
  receivedAt: string,
  decision: RuleDecision,
): ProcessResult {
  const { envelope, eventDigest } = event;
  const httpStatus =
    decision.outcome === "conflict" || decision.outcome === "blocked" ? 409
    : decision.outcome === "rejected_transition" ? 422
    : 200;
  const quarantineId = decision.quarantine?.row.quarantineId;
  return {
    kind: "ack",
    httpStatus,
    ack: {
      schemaVersion: ACK_SCHEMA_VERSION,
      eventId: envelope.eventId,
      aggregateKind: envelope.aggregateKind,
      aggregateId: envelope.aggregateId,
      version: envelope.version,
      outcome: decision.outcome,
      ...(decision.conflictKind ? { conflictKind: decision.conflictKind } : {}),
      ...(quarantineId ? { quarantineId } : {}),
      storedVersion: decision.storedVersion,
      receivedAt,
    },
    applied: decision.applied,
    invalidatesAccess: decision.invalidatesAccess,
    replayed: false,
    // A blocked event joins an open quarantine but is not itself an alert.
    quarantineAlert:
      decision.quarantine && decision.outcome !== "blocked"
        ? {
            quarantineId: decision.quarantine.row.quarantineId,
            aggregateKind: decision.quarantine.row.aggregateKind,
            aggregateId: decision.quarantine.row.aggregateId,
            version: decision.quarantine.row.version,
            kind: decision.quarantine.row.kind,
            eventId: envelope.eventId,
            eventDigest,
            opened: decision.quarantine.opened,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Resolution (§3.4 step 5) — explicit only; never invoked automatically
// ---------------------------------------------------------------------------

export interface QuarantineResolution {
  readonly quarantineId: string;
  readonly resolution: "adopted_owner_state" | "operator_override";
  readonly resolvedBy: string;
  readonly resolvedAt: string;
}

export interface QuarantineResolutionStore {
  /**
   * One transaction: quarantine -> resolved; every conflict /
   * rejected_transition variant under it gains resolvedOutcome = superseded;
   * blocked variants are left for re-evaluation. Returns false when the
   * quarantine is unknown or already resolved.
   */
  resolveQuarantine(resolution: QuarantineResolution): Promise<boolean>;
}
