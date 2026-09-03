/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 — real `LifecycleAggregateStore` adapters.
 *
 * lifecycleDispatcher.ts deliberately does not import other stages'
 * repositories — their interfaces are shaped around domain operations
 * (`revokeLink`, `accept`, ...), not a generic "read/write current lifecycle
 * state" surface. This file is the bridge: four small adapters, one per
 * aggregate kind with a real table, each talking to that table directly via
 * the shared `SqlClient` seam rather than routing through the owning stage's
 * repository. That keeps this file additive-only — no other stage's file is
 * touched — while still closing the gap bootstrap.ts's own comment flagged as
 * follow-up work.
 *
 * `entitlement` has no table anywhere in this codebase (no entitlement
 * persistence layer has been built at all — see
 * `entitlement/entitlementConsumer.ts`'s own module comment) so it is
 * deliberately NOT adapted here. Inbound entitlement sync events continue to
 * answer 503 (`STORE_NOT_CONFIGURED`), which is correct: there is nothing to
 * write them into yet, and fabricating a table here would be exactly the kind
 * of speculative persistence this project's standing rules warn against.
 *
 * WRITE SAFETY: `saveState` uses a conditional `UPDATE ... WHERE version <
 * $newVersion` rather than an unconditional write. The dispatcher already
 * decided in memory that this transition is valid against the version it
 * loaded, but load and save are two separate round trips — if a concurrent
 * writer advanced the row further in between, an unconditional write would
 * regress it. The conditional guard makes that impossible: a losing writer's
 * UPDATE simply matches zero rows and is silently a no-op, which is the same
 * "stale event dropped without regressing state" behaviour
 * `applyLifecycleEvent` already guarantees in memory, now also guaranteed
 * against a real concurrent writer in the database.
 */

import type { SqlClient } from "../persistence/types.ts";
import type {
  AggregateLifecycleState,
  LifecycleAggregateStore,
} from "./lifecycleDispatcher.ts";

/**
 * Thrown by `saveState` when the aggregate has no local row at all — as
 * opposed to a row that exists but already moved past the version being
 * written, which is a legitimate silent no-op (see the module comment).
 *
 * These four tables are populated by their OWNING stage's own creation flow
 * (Stage 2 accept, Stage 4 create, Stage 7 create, Stage 8 accept) — never by
 * this generic adapter, since it does not know the required NOT NULL columns
 * specific to each table (relationship refs, consent receipts, purposes,
 * ...). If an inbound sync event arrives for an aggregate InvestScape has
 * never locally created, that is a real integration problem (the two sides'
 * views of the world have diverged) and must surface as a hard failure, not
 * a silently-dropped write that the caller is told succeeded.
 */
export class AggregateNotFoundError extends Error {
  constructor(aggregateId: string) {
    super(`No local row exists for aggregate "${aggregateId}"`);
    this.name = "AggregateNotFoundError";
  }
}

/** Builds a `LifecycleAggregateStore` for a single table with a known shape. */
function sqlAggregateStore(
  client: SqlClient,
  table: string,
  idColumn: string,
  occurredAtColumn: string,
): LifecycleAggregateStore {
  return {
    async loadState(aggregateId: string): Promise<AggregateLifecycleState | null> {
      const result = await client.query<{
        state: string;
        version: number;
        occurred_at: Date | string;
      }>(
        `select state, version, ${occurredAtColumn} as occurred_at
           from ${table}
          where ${idColumn} = $1`,
        [aggregateId],
      );
      const row = result.rows[0];
      if (!row) return null;
      const occurredAt =
        row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at);
      return { state: row.state, version: row.version, occurredAt };
    },

    async saveState(aggregateId: string, state: AggregateLifecycleState): Promise<void> {
      // Conditional on version to guard against a concurrent writer advancing
      // the row between this adapter's own loadState and saveState calls —
      // see the module comment. A zero-row update is AMBIGUOUS on its own: it
      // means either "someone else already advanced this row further"
      // (legitimate, silent no-op) or "this row never existed at all" (a real
      // error the caller must not be told succeeded). Distinguish them with a
      // follow-up existence check, since Postgres alone can't tell them apart
      // from an affected-row count of zero.
      // `link` has no separate lifecycle-occurred-at column — its own
      // `updated_at` IS the occurredAt column (see the create*AggregateStore
      // factories below). The other three tables have a distinct
      // `lifecycle_occurred_at` alongside a general-purpose `updated_at`
      // bookkeeping column. Setting `updated_at = now()` unconditionally
      // would assign the same column twice — a real Postgres syntax error —
      // whenever `occurredAtColumn` already IS `updated_at`.
      const bookkeepingClause = occurredAtColumn === "updated_at" ? "" : ", updated_at = now()";
      const result = await client.query(
        `update ${table}
            set state = $1, version = $2, ${occurredAtColumn} = $3${bookkeepingClause}
          where ${idColumn} = $4 and version < $2`,
        [state.state, state.version, state.occurredAt, aggregateId],
      );
      if (result.rowCount === 0) {
        const existing = await client.query(`select 1 from ${table} where ${idColumn} = $1`, [
          aggregateId,
        ]);
        if (existing.rowCount === 0) {
          throw new AggregateNotFoundError(aggregateId);
        }
        // Row exists but is already at or past this version — legitimate
        // stale write, silently dropped, matching applyLifecycleEvent's own
        // in-memory "stale" semantics.
      }
    },
  };
}

export function createLinkAggregateStore(client: SqlClient): LifecycleAggregateStore {
  return sqlAggregateStore(client, "lighthouse.cross_product_links", "cross_product_link_id", "updated_at");
}

export function createShareGrantAggregateStore(client: SqlClient): LifecycleAggregateStore {
  return sqlAggregateStore(client, "lighthouse.share_grants", "share_grant_id", "lifecycle_occurred_at");
}

export function createAdminAssignmentAggregateStore(client: SqlClient): LifecycleAggregateStore {
  return sqlAggregateStore(client, "lighthouse.admin_assignments", "assignment_id", "lifecycle_occurred_at");
}

export function createMandateAggregateStore(client: SqlClient): LifecycleAggregateStore {
  return sqlAggregateStore(client, "lighthouse.delegation_mandates", "mandate_id", "lifecycle_occurred_at");
}
