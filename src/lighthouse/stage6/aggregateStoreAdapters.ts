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

import type { SqlClient, TransactionalSqlClient } from "../persistence/types.ts";
import {
  LINK_STATES_REVOKING_GRANTS,
  revokeDependentShareGrants,
} from "../stage2/linkRepository.ts";
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
      // Every aggregate table has `check (state <> 'revoked' or revoked_at is
      // not null)`. Without this clause an inbound revocation violates it and
      // the whole event fails at the database.
      const revokedClause = state.state === "revoked" ? ", revoked_at = coalesce(revoked_at, $3)" : "";
      const result = await client.query(
        `update ${table}
            set state = $1, version = $2, ${occurredAtColumn} = $3${bookkeepingClause}${revokedClause}
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

/**
 * Link aggregate. Reads like every other aggregate; WRITES differ: a link
 * moving to a grant-ending state (revoked/expired) revokes every active grant
 * riding on it in the SAME transaction, through the same helper the
 * user-initiated unlink uses. An inbound Relationship OS unlink therefore can
 * never leave a committed state in which the link is gone but a grant is live.
 */
export function createLinkAggregateStore(client: TransactionalSqlClient): LifecycleAggregateStore {
  const reads = sqlAggregateStore(client, "lighthouse.cross_product_links", "cross_product_link_id", "updated_at");
  return {
    loadState: reads.loadState,
    async saveState(aggregateId: string, state: AggregateLifecycleState): Promise<void> {
      await client.transaction(async (tx) => {
        const result = await tx.query<{ investscape_actor_ref: string }>(
          `update lighthouse.cross_product_links
              set state = $1, version = $2, updated_at = $3
                  ${LINK_STATES_REVOKING_GRANTS.includes(state.state) ? ", revoked_at = coalesce(revoked_at, $3)" : ""}
            where cross_product_link_id = $4 and version < $2
            returning investscape_actor_ref`,
          [state.state, state.version, state.occurredAt, aggregateId],
        );
        const row = result.rows[0];
        if (!row) {
          const existing = await tx.query(
            "select 1 from lighthouse.cross_product_links where cross_product_link_id = $1",
            [aggregateId],
          );
          if (existing.rowCount === 0) throw new AggregateNotFoundError(aggregateId);
          return; // stale write: a newer version is already stored
        }
        if (LINK_STATES_REVOKING_GRANTS.includes(state.state)) {
          await revokeDependentShareGrants(tx, aggregateId, String(row.investscape_actor_ref), state.occurredAt);
        }
      });
    },
  };
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

// ---------------------------------------------------------------------------
// Transaction-scoped access for the event-integrity processor
// ---------------------------------------------------------------------------

/** Table shape of every aggregate kind that has a local table. */
export const AGGREGATE_TABLES: Readonly<Record<string, { table: string; idColumn: string; occurredAtColumn: string }>> = {
  link: { table: "lighthouse.cross_product_links", idColumn: "cross_product_link_id", occurredAtColumn: "updated_at" },
  share_grant: { table: "lighthouse.share_grants", idColumn: "share_grant_id", occurredAtColumn: "lifecycle_occurred_at" },
  admin_assignment: { table: "lighthouse.admin_assignments", idColumn: "assignment_id", occurredAtColumn: "lifecycle_occurred_at" },
  mandate: { table: "lighthouse.delegation_mandates", idColumn: "mandate_id", occurredAtColumn: "lifecycle_occurred_at" },
};

/**
 * Reads an aggregate's lifecycle projection and locks its row until the
 * enclosing transaction ends, so the rules decide against a state no
 * concurrent writer can move underneath them.
 */
export async function loadAggregateForUpdate(
  tx: SqlClient,
  aggregateKind: string,
  aggregateId: string,
): Promise<AggregateLifecycleState | null> {
  const shape = AGGREGATE_TABLES[aggregateKind];
  if (!shape) return null;
  const result = await tx.query<{ state: string; version: number; occurred_at: Date | string }>(
    `select state, version, ${shape.occurredAtColumn} as occurred_at
       from ${shape.table}
      where ${shape.idColumn} = $1
      for update`,
    [aggregateId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const occurredAt =
    row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at);
  return { state: row.state, version: row.version, occurredAt };
}

/**
 * The adapter for `aggregateKind`, bound to an ALREADY-OPEN transaction.
 * The link adapter's own `transaction()` joins the enclosing one instead of
 * opening a second, so its grant cascade commits or rolls back with the
 * event's ledger rows.
 */
export function aggregateStoreInTransaction(
  tx: SqlClient,
  aggregateKind: string,
): LifecycleAggregateStore | null {
  const joined: TransactionalSqlClient = {
    query: (sql, params) => tx.query(sql, params),
    transaction: (fn) => fn(tx),
  };
  switch (aggregateKind) {
    case "link": return createLinkAggregateStore(joined);
    case "share_grant": return createShareGrantAggregateStore(tx);
    case "admin_assignment": return createAdminAssignmentAggregateStore(tx);
    case "mandate": return createMandateAggregateStore(tx);
    default: return null;
  }
}
