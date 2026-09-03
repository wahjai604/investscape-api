/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 7 persistence — cross-product administration assignments.
 *
 * `createAdminAssignment()` in domain/adminAssignment.ts is a pure function:
 * given an input it either returns a fully-formed `AdminAssignment` or a
 * denial reason. This repository's only job on the write path is to run that
 * decision and, if it succeeds, persist the result — the domain layer is not
 * modified or second-guessed here.
 *
 * REVOKE IS STRUCTURALLY DIFFERENT FROM EVERY OTHER STAGE
 *
 * Stage 2's and Stage 4's `revoke()` enforce ownership INSIDE the WHERE
 * clause (`client_user_ref = $2`) because the caller revoking is always the
 * same actor who owns the row. Stage 7 has no such relationship: the actor
 * revoking an admin assignment is essentially never its own grantee — it is
 * whoever currently holds `ADMIN_MANAGEMENT_SCOPE`, resolved via
 * `effectiveScopesFor` and checked by `authorizeRevocation()` in the domain
 * layer, which the ROUTE calls before this repository is ever touched. So
 * `revoke()` here does not take a revoker identity at all; its only job is
 * the atomic state transition (compare-and-set on `expectedVersion`, guarded
 * by `state = 'active'`), which is the part that genuinely needs to live at
 * the storage boundary. Authorization already happened; this method cannot
 * be misused to bypass it because it has no ownership predicate to bypass.
 *
 * BOOTSTRAP NEVER APPEARS HERE
 *
 * `findActiveScopesForActor` returns only STORED scopes from real rows. The
 * bootstrap seed-actor override lives entirely in domain/adminAssignment.ts's
 * `effectiveScopesFor`, called by the route after combining this repository's
 * result with the seed ref from env. This repository does not know the seed
 * ref exists.
 */

import {
  createAdminAssignment,
  type AdminAssignment,
  type AdminAssignmentResult,
  type CreateAdminAssignmentInput,
  ADMIN_MANAGEMENT_SCOPE,
} from "../domain/adminAssignment.ts";
import type { TransactionalSqlClient } from "../persistence/types.ts";

export interface AdminAssignmentRevocation {
  readonly assignmentId: string;
  readonly revokedAt: string;
  readonly correlationId: string;
}

export interface AdminAssignmentRepository {
  /** Runs the domain decision and persists the assignment on success. */
  create(input: CreateAdminAssignmentInput): Promise<AdminAssignmentResult>;
  findById(assignmentId: string): Promise<AdminAssignment | null>;
  /**
   * The stored (non-bootstrap) active, unexpired scopes for an actor — the
   * caller combines this with `effectiveScopesFor` to get the actor's true
   * effective scopes.
   */
  findActiveScopesForActor(actorRef: string, now: Date): Promise<readonly string[]>;
  /** The actor's own active, unexpired assignments (their "my grants" view). */
  findActiveAssignmentsForActor(actorRef: string, now: Date): Promise<readonly AdminAssignment[]>;
  /**
   * Count of OTHER active, unexpired assignments (excluding `excludeAssignmentId`)
   * that currently hold `ADMIN_MANAGEMENT_SCOPE`. Feeds the last-admin lockout
   * guard in `authorizeRevocation`. Never counts the bootstrap seed actor —
   * there is no row for it to count.
   */
  countOtherActiveManagementHolders(excludeAssignmentId: string, now: Date): Promise<number>;
  /**
   * Compare-and-set state transition to 'revoked'. NOT an ownership check —
   * authorization ("is this revoker allowed to revoke") is the route's job,
   * already decided via `authorizeRevocation()` before this is called. This
   * method only guards against a stale read and a double-revoke, via
   * `expectedVersion` and `state = 'active'` inside the WHERE clause.
   */
  revoke(
    assignmentId: string,
    expectedVersion: number,
    now: Date,
  ): Promise<AdminAssignmentRevocation | null>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function assignmentFromRow(row: Record<string, unknown>): AdminAssignment {
  return {
    assignmentId: String(row.assignment_id),
    granteeActorRef: String(row.grantee_actor_ref),
    grantedByActorRef: String(row.granted_by_actor_ref),
    scopes: parseJsonArray(row.scopes) as readonly string[],
    purpose: String(row.purpose),
    effectiveFrom: new Date(row.effective_from as string).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at as string).toISOString() : null,
    correlationId: String(row.correlation_id),
    lifecycle: {
      state: row.state as AdminAssignment["lifecycle"]["state"],
      version: Number(row.version),
      occurredAt: new Date(row.lifecycle_occurred_at as string).toISOString(),
      appliedEventIds: parseJsonArray(row.applied_event_ids) as readonly string[],
    },
  };
}

function parseJsonArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const ASSIGNMENT_COLUMNS = `assignment_id, grantee_actor_ref, granted_by_actor_ref,
  scopes, purpose, effective_from, expires_at, correlation_id, state, version,
  lifecycle_occurred_at, applied_event_ids`;

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export class SqlAdminAssignmentRepository implements AdminAssignmentRepository {
  readonly #client: TransactionalSqlClient;

  constructor(client: TransactionalSqlClient) {
    this.#client = client;
  }

  async create(input: CreateAdminAssignmentInput): Promise<AdminAssignmentResult> {
    const decision = createAdminAssignment(input);
    if (!decision.ok) return decision;

    const assignment = decision.assignment;
    await this.#client.query(
      `insert into lighthouse.admin_assignments
         (assignment_id, grantee_actor_ref, granted_by_actor_ref, scopes,
          purpose, effective_from, expires_at, correlation_id, state, version,
          lifecycle_occurred_at, applied_event_ids)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        assignment.assignmentId,
        assignment.granteeActorRef,
        assignment.grantedByActorRef,
        JSON.stringify(assignment.scopes),
        assignment.purpose,
        assignment.effectiveFrom,
        assignment.expiresAt,
        assignment.correlationId,
        assignment.lifecycle.state,
        assignment.lifecycle.version,
        assignment.lifecycle.occurredAt,
        JSON.stringify(assignment.lifecycle.appliedEventIds),
      ],
    );
    return decision;
  }

  async findById(assignmentId: string): Promise<AdminAssignment | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${ASSIGNMENT_COLUMNS} from lighthouse.admin_assignments where assignment_id = $1`,
      [assignmentId],
    );
    const row = result.rows[0];
    return row ? assignmentFromRow(row) : null;
  }

  async findActiveScopesForActor(actorRef: string, now: Date): Promise<readonly string[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select scopes from lighthouse.admin_assignments
        where grantee_actor_ref = $1
          and state = 'active'
          and (expires_at is null or expires_at > $2)`,
      [actorRef, now.toISOString()],
    );
    const scopes = new Set<string>();
    for (const row of result.rows) {
      for (const scope of parseJsonArray(row.scopes) as readonly string[]) scopes.add(scope);
    }
    return [...scopes];
  }

  async findActiveAssignmentsForActor(
    actorRef: string,
    now: Date,
  ): Promise<readonly AdminAssignment[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${ASSIGNMENT_COLUMNS} from lighthouse.admin_assignments
        where grantee_actor_ref = $1
          and state = 'active'
          and (expires_at is null or expires_at > $2)
        order by created_at asc`,
      [actorRef, now.toISOString()],
    );
    return result.rows.map(assignmentFromRow);
  }

  async countOtherActiveManagementHolders(
    excludeAssignmentId: string,
    now: Date,
  ): Promise<number> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select count(*) as n from lighthouse.admin_assignments
        where assignment_id <> $1
          and state = 'active'
          and (expires_at is null or expires_at > $2)
          and scopes @> $3::jsonb`,
      [excludeAssignmentId, now.toISOString(), JSON.stringify([ADMIN_MANAGEMENT_SCOPE])],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  async revoke(
    assignmentId: string,
    expectedVersion: number,
    now: Date,
  ): Promise<AdminAssignmentRevocation | null> {
    // NOT an ownership check — see the class-level comment. Only the atomic
    // state transition lives here.
    const result = await this.#client.query<Record<string, unknown>>(
      `update lighthouse.admin_assignments
          set state = 'revoked', revoked_at = $3, version = version + 1,
              updated_at = $3, lifecycle_occurred_at = $3
        where assignment_id = $1
          and version = $2
          and state = 'active'
        returning assignment_id, correlation_id`,
      [assignmentId, expectedVersion, now.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      assignmentId: String(row.assignment_id),
      revokedAt: now.toISOString(),
      correlationId: String(row.correlation_id),
    };
  }
}

// ---------------------------------------------------------------------------
// In-memory (tests and explicitly opted-in local development only)
// ---------------------------------------------------------------------------

/**
 * NOT equivalent to the SQL implementation under concurrency. Node's single
 * threaded event loop makes the compare-and-set below atomic within one
 * process only; it provides no guarantee across processes. Exists so domain
 * and route tests can run without a database.
 */
export class InMemoryAdminAssignmentRepository implements AdminAssignmentRepository {
  readonly #assignments = new Map<string, AdminAssignment>();

  async create(input: CreateAdminAssignmentInput): Promise<AdminAssignmentResult> {
    const decision = createAdminAssignment(input);
    if (!decision.ok) return decision;
    this.#assignments.set(decision.assignment.assignmentId, decision.assignment);
    return decision;
  }

  async findById(assignmentId: string): Promise<AdminAssignment | null> {
    return this.#assignments.get(assignmentId) ?? null;
  }

  #isActiveAndUnexpired(assignment: AdminAssignment, now: Date): boolean {
    if (assignment.lifecycle.state !== "active") return false;
    if (assignment.expiresAt && new Date(assignment.expiresAt) <= now) return false;
    return true;
  }

  async findActiveScopesForActor(actorRef: string, now: Date): Promise<readonly string[]> {
    const scopes = new Set<string>();
    for (const assignment of this.#assignments.values()) {
      if (assignment.granteeActorRef !== actorRef) continue;
      if (!this.#isActiveAndUnexpired(assignment, now)) continue;
      for (const scope of assignment.scopes) scopes.add(scope);
    }
    return [...scopes];
  }

  async findActiveAssignmentsForActor(
    actorRef: string,
    now: Date,
  ): Promise<readonly AdminAssignment[]> {
    return [...this.#assignments.values()].filter(
      (a) => a.granteeActorRef === actorRef && this.#isActiveAndUnexpired(a, now),
    );
  }

  async countOtherActiveManagementHolders(
    excludeAssignmentId: string,
    now: Date,
  ): Promise<number> {
    let count = 0;
    for (const assignment of this.#assignments.values()) {
      if (assignment.assignmentId === excludeAssignmentId) continue;
      if (!this.#isActiveAndUnexpired(assignment, now)) continue;
      if (assignment.scopes.includes(ADMIN_MANAGEMENT_SCOPE)) count += 1;
    }
    return count;
  }

  async revoke(
    assignmentId: string,
    expectedVersion: number,
    now: Date,
  ): Promise<AdminAssignmentRevocation | null> {
    const assignment = this.#assignments.get(assignmentId);
    if (
      !assignment ||
      assignment.lifecycle.version !== expectedVersion ||
      assignment.lifecycle.state !== "active"
    ) {
      return null;
    }
    this.#assignments.set(assignmentId, {
      ...assignment,
      lifecycle: {
        ...assignment.lifecycle,
        state: "revoked",
        version: assignment.lifecycle.version + 1,
        occurredAt: now.toISOString(),
      },
    });
    return {
      assignmentId,
      revokedAt: now.toISOString(),
      correlationId: assignment.correlationId,
    };
  }
}
