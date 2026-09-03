/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 — lifecycle event dispatch.
 *
 * Maps an inbound `aggregateKind` string onto the matching `LifecycleDefinition`
 * from domain/lifecycle.ts, loads the aggregate's current lifecycle state,
 * applies the event through the tested `applyLifecycleEvent()` engine, and
 * (only when the event was actually applied) persists the new state and fires
 * an invalidation hook.
 *
 * DECOUPLING NOTE: this module does NOT import LinkRepository, ShareGrantRepository
 * or any other stage's concrete repository. Those interfaces are shaped around
 * each stage's own domain operations (`revokeLink`, `accept`, ...), not a
 * generic "read/write current lifecycle state" surface, so bridging them here
 * would mean inventing generic methods those interfaces don't have and stage6
 * doesn't own. Instead this module defines its OWN minimal seam,
 * `LifecycleAggregateStore`. Wiring a real adapter from each stage's repository
 * to this interface — e.g. a `LinkLifecycleAggregateStore` backed by
 * `LinkRepository` — is follow-up integration work, not done here, so as not to
 * touch stage2/4/7/8 files owned by concurrent changes.
 */

import {
  applyLifecycleEvent,
  initialSnapshot,
  LINK_LIFECYCLE,
  SHARE_GRANT_LIFECYCLE,
  MANDATE_LIFECYCLE,
  ADMIN_ASSIGNMENT_LIFECYCLE,
  ENTITLEMENT_LIFECYCLE,
  type LifecycleApplyOutcome,
  type LifecycleDefinition,
  type LifecycleEvent,
} from "../domain/lifecycle.ts";

export const AGGREGATE_KINDS = [
  "link",
  "share_grant",
  "mandate",
  "admin_assignment",
  "entitlement",
] as const;

export type AggregateKind = (typeof AGGREGATE_KINDS)[number];

export function isKnownAggregateKind(kind: string): kind is AggregateKind {
  return (AGGREGATE_KINDS as readonly string[]).includes(kind);
}

const DEFINITIONS: Readonly<Record<AggregateKind, LifecycleDefinition<string>>> = {
  link: LINK_LIFECYCLE as LifecycleDefinition<string>,
  share_grant: SHARE_GRANT_LIFECYCLE as LifecycleDefinition<string>,
  mandate: MANDATE_LIFECYCLE as LifecycleDefinition<string>,
  admin_assignment: ADMIN_ASSIGNMENT_LIFECYCLE as LifecycleDefinition<string>,
  entitlement: ENTITLEMENT_LIFECYCLE as LifecycleDefinition<string>,
};

export function definitionFor(kind: AggregateKind): LifecycleDefinition<string> {
  return DEFINITIONS[kind];
}

export interface AggregateLifecycleState {
  readonly state: string;
  readonly version: number;
  readonly occurredAt: string;
}

/**
 * Minimal read/write seam onto an aggregate's own lifecycle projection. Each
 * aggregate kind's real backing store (Stage 2 links, Stage 4 share grants,
 * Stage 7 admin assignments, Stage 8 mandates) can implement this once it
 * exposes a generic state read/write path — see the module doc above.
 */
export interface LifecycleAggregateStore {
  loadState(aggregateId: string): Promise<AggregateLifecycleState | null>;
  saveState(aggregateId: string, state: AggregateLifecycleState): Promise<void>;
}

/** In-memory store for tests and for aggregate kinds with no wired adapter yet. */
export class InMemoryLifecycleAggregateStore implements LifecycleAggregateStore {
  readonly #byId = new Map<string, AggregateLifecycleState>();

  async loadState(aggregateId: string): Promise<AggregateLifecycleState | null> {
    return this.#byId.get(aggregateId) ?? null;
  }

  async saveState(aggregateId: string, state: AggregateLifecycleState): Promise<void> {
    this.#byId.set(aggregateId, state);
  }
}

export interface DispatchDependencies {
  readonly stores: Readonly<Partial<Record<AggregateKind, LifecycleAggregateStore>>>;
  /**
   * Fired when the applied event moves the aggregate into a
   * `revoking`/invalidating state. A simple injected callback — this codebase
   * has no real cache layer to invalidate yet, so building one here would be
   * speculative.
   */
  readonly onInvalidate?: (
    aggregateKind: AggregateKind,
    aggregateId: string,
  ) => Promise<void> | void;
}

export type DispatchResult =
  | { readonly ok: true; readonly outcome: LifecycleApplyOutcome<string> }
  | {
      readonly ok: false;
      readonly reason: "UNKNOWN_AGGREGATE_KIND" | "STORE_NOT_CONFIGURED" | "AGGREGATE_NOT_FOUND";
    };

/**
 * A store's `saveState` may reject a write for an aggregate it has no local
 * row for at all (as opposed to a stale version, which it must swallow
 * silently — see `LifecycleAggregateStore`'s own contract). This module does
 * not know which error type a given store implementation throws for that
 * case, so it identifies it structurally: `name === "AggregateNotFoundError"`.
 * This keeps `lifecycleDispatcher.ts` from importing a concrete adapter class
 * (`aggregateStoreAdapters.ts` is one implementation among possibly several,
 * e.g. the in-memory test store never throws this at all since it has no
 * concept of "a row that should already exist").
 */
function isAggregateNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.name === "AggregateNotFoundError";
}

export async function dispatchLifecycleEvent(
  aggregateKind: string,
  aggregateId: string,
  event: LifecycleEvent<string>,
  deps: DispatchDependencies,
): Promise<DispatchResult> {
  if (!isKnownAggregateKind(aggregateKind)) {
    return { ok: false, reason: "UNKNOWN_AGGREGATE_KIND" };
  }

  const store = deps.stores[aggregateKind];
  if (!store) {
    return { ok: false, reason: "STORE_NOT_CONFIGURED" };
  }

  const definition = DEFINITIONS[aggregateKind];
  const current = await store.loadState(aggregateId);
  const snapshot = current
    ? {
        state: current.state,
        version: current.version,
        occurredAt: current.occurredAt,
        appliedEventIds: [] as readonly string[],
        appliedEventHashes: {},
      }
    : initialSnapshot(definition, event.occurredAt);

  const outcome = applyLifecycleEvent(definition, snapshot, event);

  if (outcome.kind === "applied") {
    try {
      await store.saveState(aggregateId, {
        state: outcome.snapshot.state,
        version: outcome.snapshot.version,
        occurredAt: outcome.snapshot.occurredAt,
      });
    } catch (error) {
      if (isAggregateNotFoundError(error)) {
        return { ok: false, reason: "AGGREGATE_NOT_FOUND" };
      }
      throw error;
    }
    if (outcome.invalidatesAccess && deps.onInvalidate) {
      await deps.onInvalidate(aggregateKind, aggregateId);
    }
  }

  return { ok: true, outcome };
}
