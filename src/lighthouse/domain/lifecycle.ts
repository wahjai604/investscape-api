/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Generic monotonic lifecycle framework (Stage 6).
 *
 * Every cross-product object — account link, share grant, delegation mandate,
 * admin assignment, entitlement projection — has the same problem: signed events
 * arriving over a network, possibly duplicated, possibly out of order, and a
 * state that must never regress.
 *
 * Rather than reimplement that reasoning five times, this module provides one
 * tested engine. The requirements it encodes (STAGES_2_TO_8 prompt, Stage 6):
 *
 *   - "Events must be monotonic, idempotent and safe under duplicate or
 *      out-of-order delivery."
 *   - "A newer terminal event cannot be overwritten by an older active event."
 *   - "Revocation must invalidate caches and active sessions/contexts
 *      immediately."
 *   - "Do not erase immutable security/audit events when removing active
 *      projections."
 *
 * Ordering uses `version` (monotonic per aggregate) with `occurredAt` as the
 * tie-breaker. Wall-clock time alone is not trusted for ordering across two
 * products with independent clocks.
 */

export interface LifecycleDefinition<TState extends string> {
  readonly initial: TState;
  readonly states: readonly TState[];
  /** Terminal states can never transition away. */
  readonly terminal: readonly TState[];
  /** from -> allowed next states. */
  readonly transitions: Readonly<Record<TState, readonly TState[]>>;
  /**
   * States where the subject's access must be treated as gone. Entering one
   * triggers cache/session invalidation.
   */
  readonly revoking: readonly TState[];
}

export interface LifecycleEvent<TState extends string> {
  /** Unique event identifier. Used for idempotency. */
  readonly eventId: string;
  readonly targetState: TState;
  /** Monotonic per aggregate. Higher wins. */
  readonly version: number;
  readonly occurredAt: string;
  readonly correlationId?: string;
  /**
   * CONFIRMED DEFECT (2026-09-02 architecture review, P0): idempotency keyed
   * on eventId alone means a reused eventId with ALTERED bytes was previously
   * treated as an ordinary duplicate and silently dropped — no error, no
   * quarantine, no audit trail. That is worse than rejecting: the caller
   * believes their (different) event was applied.
   *
   * `payloadHash` binds the eventId to a canonical hash of the event's
   * meaningful fields (caller's responsibility to compute consistently,
   * e.g. sha256 of a canonical JSON of targetState+version+occurredAt+any
   * event-specific payload). Optional for backward compatibility with
   * existing callers, but any caller processing untrusted/replayed events
   * MUST supply it.
   */
  readonly payloadHash?: string;
}

export interface LifecycleSnapshot<TState extends string> {
  readonly state: TState;
  readonly version: number;
  readonly occurredAt: string;
  /** Event IDs already applied. Enables exact idempotency. */
  readonly appliedEventIds: readonly string[];
  /** eventId -> payloadHash, for the same window as appliedEventIds. */
  readonly appliedEventHashes?: Readonly<Record<string, string>>;
}

export type LifecycleApplyOutcome<TState extends string> =
  | {
      readonly kind: "applied";
      readonly snapshot: LifecycleSnapshot<TState>;
      /** True when the new state requires immediate access invalidation. */
      readonly invalidatesAccess: boolean;
    }
  /** Already seen, identical payload. Safe no-op. */
  | { readonly kind: "duplicate"; readonly snapshot: LifecycleSnapshot<TState> }
  /**
   * Same eventId seen before, but with a DIFFERENT payload hash. Never
   * applied and never silently dropped — this is a data-integrity conflict
   * requiring reconciliation, not a replay.
   */
  | { readonly kind: "conflict"; readonly snapshot: LifecycleSnapshot<TState>; readonly reason: "EVENT_ID_PAYLOAD_MISMATCH" }
  /** Arrived late; a newer version already won. Dropped without regressing. */
  | { readonly kind: "stale"; readonly snapshot: LifecycleSnapshot<TState> }
  /** The transition is not permitted by the definition. */
  | { readonly kind: "rejected"; readonly snapshot: LifecycleSnapshot<TState>; readonly reason: string };

const MAX_TRACKED_EVENT_IDS = 100;

export function initialSnapshot<TState extends string>(
  definition: LifecycleDefinition<TState>,
  occurredAt: string,
): LifecycleSnapshot<TState> {
  return {
    state: definition.initial,
    version: 0,
    occurredAt,
    appliedEventIds: [],
    appliedEventHashes: {},
  };
}

/**
 * Applies an event to a snapshot. Pure — returns a new snapshot, mutates nothing.
 *
 * Order of checks matters:
 *  1. duplicate    (idempotency beats everything; a replay is never an error)
 *  2. unknown state (fail closed, invariant 8)
 *  3. terminal     (a terminal state absorbs everything)
 *  4. stale        (older version loses)
 *  5. transition   (must be permitted)
 */
export function applyLifecycleEvent<TState extends string>(
  definition: LifecycleDefinition<TState>,
  snapshot: LifecycleSnapshot<TState>,
  event: LifecycleEvent<TState>,
): LifecycleApplyOutcome<TState> {
  // 1. Exact idempotency, now hash-checked rather than ID-only.
  if (snapshot.appliedEventIds.includes(event.eventId)) {
    const previousHash = snapshot.appliedEventHashes?.[event.eventId];
    // If either side omits a hash we cannot prove sameness; treat as a
    // duplicate (legacy/backward-compatible behaviour) rather than block
    // callers who haven't adopted payloadHash yet. Once both are present,
    // a mismatch is a real conflict, not a duplicate.
    if (previousHash !== undefined && event.payloadHash !== undefined &&
        previousHash !== event.payloadHash) {
      return { kind: "conflict", snapshot, reason: "EVENT_ID_PAYLOAD_MISMATCH" };
    }
    return { kind: "duplicate", snapshot };
  }

  // 2. Unknown target states fail closed.
  if (!definition.states.includes(event.targetState)) {
    return { kind: "rejected", snapshot, reason: "UNKNOWN_STATE" };
  }

  // 3. A terminal state absorbs later events. This is the "newer terminal event
  //    cannot be overwritten by an older active event" rule.
  if (definition.terminal.includes(snapshot.state)) {
    if (event.targetState === snapshot.state) {
      return { kind: "duplicate", snapshot };
    }
    return { kind: "rejected", snapshot, reason: "TERMINAL_STATE" };
  }

  // 4. Out-of-order protection.
  if (event.version < snapshot.version) {
    return { kind: "stale", snapshot };
  }
  if (event.version === snapshot.version && snapshot.version !== 0) {
    // Same version, different event: keep the earliest-observed decision rather
    // than letting a coin-flip reorder change the outcome.
    if (event.occurredAt <= snapshot.occurredAt) {
      return { kind: "stale", snapshot };
    }
  }

  // 5. Permitted transition?
  const allowed = definition.transitions[snapshot.state] ?? [];
  if (!allowed.includes(event.targetState)) {
    return { kind: "rejected", snapshot, reason: "TRANSITION_NOT_PERMITTED" };
  }

  const appliedEventIds = [...snapshot.appliedEventIds, event.eventId].slice(
    -MAX_TRACKED_EVENT_IDS,
  );
  const trackedIdSet = new Set(appliedEventIds);
  const appliedEventHashes: Record<string, string> = {};
  for (const [id, hash] of Object.entries(snapshot.appliedEventHashes ?? {})) {
    if (trackedIdSet.has(id)) appliedEventHashes[id] = hash;
  }
  if (event.payloadHash !== undefined) {
    appliedEventHashes[event.eventId] = event.payloadHash;
  }

  return {
    kind: "applied",
    snapshot: {
      state: event.targetState,
      version: event.version,
      occurredAt: event.occurredAt,
      appliedEventIds,
      appliedEventHashes,
    },
    invalidatesAccess: definition.revoking.includes(event.targetState),
  };
}

/** Folds a batch of events in arbitrary order. Result is order-independent. */
export function replayLifecycle<TState extends string>(
  definition: LifecycleDefinition<TState>,
  events: readonly LifecycleEvent<TState>[],
  startedAt: string,
): LifecycleSnapshot<TState> {
  let snapshot = initialSnapshot(definition, startedAt);
  // Sort defensively so a shuffled batch converges on the same answer.
  const ordered = [...events].sort(
    (a, b) => a.version - b.version || a.occurredAt.localeCompare(b.occurredAt),
  );
  for (const event of ordered) {
    const outcome = applyLifecycleEvent(definition, snapshot, event);
    if (outcome.kind === "applied") snapshot = outcome.snapshot;
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Concrete lifecycles
// ---------------------------------------------------------------------------

/** Stage 2: cross-product account link. */
export type LinkState = "pending" | "active" | "suspended" | "revoked" | "expired";

export const LINK_LIFECYCLE: LifecycleDefinition<LinkState> = {
  initial: "pending",
  states: ["pending", "active", "suspended", "revoked", "expired"],
  terminal: ["revoked", "expired"],
  transitions: {
    pending: ["active", "revoked", "expired"],
    active: ["suspended", "revoked"],
    suspended: ["active", "revoked", "expired"],
    revoked: [],
    expired: [],
  },
  revoking: ["suspended", "revoked", "expired"],
};

/** Stage 4: client-selected share grant. */
export type ShareGrantState = "active" | "expired" | "revoked" | "tombstoned";

export const SHARE_GRANT_LIFECYCLE: LifecycleDefinition<ShareGrantState> = {
  initial: "active",
  states: ["active", "expired", "revoked", "tombstoned"],
  // Tombstoned is the true terminal: it is what a deleted analysis produces.
  terminal: ["tombstoned"],
  transitions: {
    active: ["expired", "revoked", "tombstoned"],
    expired: ["tombstoned", "revoked"],
    revoked: ["tombstoned"],
    tombstoned: [],
  },
  revoking: ["expired", "revoked", "tombstoned"],
};

/** Stage 8: delegated client mandate. */
export type MandateState =
  | "requested" | "pending_client_acceptance" | "active"
  | "suspended" | "expired" | "revoked";

export const MANDATE_LIFECYCLE: LifecycleDefinition<MandateState> = {
  initial: "requested",
  states: [
    "requested", "pending_client_acceptance", "active",
    "suspended", "expired", "revoked",
  ],
  terminal: ["revoked", "expired"],
  transitions: {
    requested: ["pending_client_acceptance", "revoked", "expired"],
    pending_client_acceptance: ["active", "revoked", "expired"],
    active: ["suspended", "expired", "revoked"],
    // Reactivation from suspended is allowed (e.g. eligibility restored), but
    // never from a terminal state — that requires a fresh mandate.
    suspended: ["active", "expired", "revoked"],
    expired: [],
    revoked: [],
  },
  revoking: ["suspended", "expired", "revoked"],
};

/** Stage 7: administrative assignment. */
export type AdminAssignmentState = "active" | "suspended" | "revoked" | "expired";

export const ADMIN_ASSIGNMENT_LIFECYCLE: LifecycleDefinition<AdminAssignmentState> = {
  initial: "active",
  states: ["active", "suspended", "revoked", "expired"],
  terminal: ["revoked", "expired"],
  transitions: {
    active: ["suspended", "revoked", "expired"],
    suspended: ["active", "revoked", "expired"],
    revoked: [],
    expired: [],
  },
  revoking: ["suspended", "revoked", "expired"],
};

/** Lighthouse suite entitlement projection. */
export type EntitlementState =
  | "trialing" | "active" | "grace_period" | "suspended"
  | "cancelled_at_term_end" | "expired" | "revoked";

export const ENTITLEMENT_LIFECYCLE: LifecycleDefinition<EntitlementState> = {
  initial: "trialing",
  states: [
    "trialing", "active", "grace_period", "suspended",
    "cancelled_at_term_end", "expired", "revoked",
  ],
  terminal: ["expired", "revoked"],
  transitions: {
    trialing: ["active", "expired", "revoked", "cancelled_at_term_end"],
    active: ["grace_period", "suspended", "cancelled_at_term_end", "expired", "revoked"],
    grace_period: ["active", "suspended", "expired", "revoked"],
    suspended: ["active", "expired", "revoked"],
    cancelled_at_term_end: ["active", "expired", "revoked"],
    expired: [],
    revoked: [],
  },
  revoking: ["suspended", "expired", "revoked"],
};
