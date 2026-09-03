/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 4 persistence — client-selected share grants.
 *
 * `createShareGrant()` in domain/shareGrant.ts is a pure function: given an
 * input it either returns a fully-formed `ShareGrant` or a denial reason. This
 * repository's only job on the write path is to run that decision and, if it
 * succeeds, persist the result — the domain layer is not modified or
 * second-guessed here.
 *
 * OWNERSHIP IN THE WHERE CLAUSE, NOT CHECK-THEN-ACT
 *
 * `revoke()` follows the exact shape of Stage 2's `revokeLink`: ownership
 * (`client_user_ref = $2`) and the compare-and-set (`version = $3`) both live
 * inside the UPDATE's WHERE clause. There is no separate "load it, check the
 * owner, then write" sequence, so there is no window in which a grant
 * belonging to a different client could be revoked by a caller who read the
 * row before someone else's mutation.
 *
 * READ-SIDE SCOPING
 *
 * `findActiveGrantsForRelationship` is what a professional's client-summary
 * read will eventually call. It filters on `destination_relationship_ref` and
 * `recipient_context` and nothing else — there is no parameter that could
 * widen it into "every grant this client has ever made" or "every analysis
 * this client owns". A grant that was never created for this relationship
 * simply cannot appear, which is the enforcement point for receiver prompt
 * §14 ("a cross-product link must not enable queries for unshared analyses").
 */

import {
  createShareGrant,
  type ConsentReceipt,
  type CreateShareGrantInput,
  type ShareCreationResult,
  type ShareGrant,
} from "../domain/shareGrant.ts";
import type { ShareableField } from "../contracts/crossProduct.ts";
import type { TransactionalSqlClient } from "../persistence/types.ts";

export interface ShareGrantRevocation {
  readonly shareGrantId: string;
  readonly revokedAt: string;
  readonly correlationId: string;
}

export interface ShareGrantRepository {
  /** Runs the domain decision and persists the grant on success. */
  create(input: CreateShareGrantInput): Promise<ShareCreationResult>;
  findById(shareGrantId: string): Promise<ShareGrant | null>;
  /** The client's OWN active grants. */
  findActiveGrantsForClient(clientUserRef: string): Promise<readonly ShareGrant[]>;
  /**
   * Active grants addressed to a specific relationship + recipient context.
   * Must NOT be usable to list a client's unshared analyses — only grants
   * that were explicitly created for this (relationship, context) pair can
   * ever appear.
   */
  findActiveGrantsForRelationship(
    destinationRelationshipRef: string,
    recipientContext: string,
  ): Promise<readonly ShareGrant[]>;
  /**
   * Compare-and-set revoke. Ownership and version are enforced inside the
   * WHERE clause. Returns null for "not found", "not yours", "stale version"
   * and "already terminal" alike — those are indistinguishable on purpose.
   */
  revoke(
    shareGrantId: string,
    clientUserRef: string,
    expectedVersion: number,
    now: Date,
  ): Promise<ShareGrantRevocation | null>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function grantFromRow(row: Record<string, unknown>): ShareGrant {
  return {
    shareGrantId: String(row.share_grant_id),
    crossProductLinkId: String(row.cross_product_link_id),
    clientUserRef: String(row.client_user_ref),
    destinationRelationshipRef: String(row.destination_relationship_ref),
    recipientContext: String(row.recipient_context),
    selectedAnalysisIds: parseJsonArray(row.selected_analysis_ids) as readonly string[],
    selectedFields: parseJsonArray(row.selected_fields) as readonly ShareableField[],
    purpose: String(row.purpose),
    effectiveFrom: new Date(row.effective_from as string).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at as string).toISOString() : null,
    consent: parseConsent(row.consent),
    correlationId: String(row.correlation_id),
    lifecycle: {
      state: row.state as ShareGrant["lifecycle"]["state"],
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

function parseConsent(value: unknown): ConsentReceipt {
  const raw = typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : (value as Record<string, unknown>);
  return {
    noticeVersion: String(raw.noticeVersion),
    affirmedAt: String(raw.affirmedAt),
    affirmedByUserRef: String(raw.affirmedByUserRef),
    purpose: String(raw.purpose),
    selectedFields: (raw.selectedFields as readonly ShareableField[]) ?? [],
    selectedAnalysisIds: (raw.selectedAnalysisIds as readonly string[]) ?? [],
    destinationRelationshipRef: String(raw.destinationRelationshipRef),
    correlationId: String(raw.correlationId),
  };
}

const GRANT_COLUMNS = `share_grant_id, cross_product_link_id, client_user_ref,
  destination_relationship_ref, recipient_context, selected_analysis_ids,
  selected_fields, purpose, effective_from, expires_at, consent,
  correlation_id, state, version, lifecycle_occurred_at, applied_event_ids`;

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export class SqlShareGrantRepository implements ShareGrantRepository {
  readonly #client: TransactionalSqlClient;

  constructor(client: TransactionalSqlClient) {
    this.#client = client;
  }

  async create(input: CreateShareGrantInput): Promise<ShareCreationResult> {
    const decision = createShareGrant(input);
    if (!decision.ok) return decision;

    const grant = decision.grant;
    await this.#client.query(
      `insert into lighthouse.share_grants
         (share_grant_id, cross_product_link_id, client_user_ref,
          destination_relationship_ref, recipient_context, selected_analysis_ids,
          selected_fields, purpose, effective_from, expires_at, consent,
          correlation_id, state, version, lifecycle_occurred_at, applied_event_ids)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        grant.shareGrantId,
        grant.crossProductLinkId,
        grant.clientUserRef,
        grant.destinationRelationshipRef,
        grant.recipientContext,
        JSON.stringify(grant.selectedAnalysisIds),
        JSON.stringify(grant.selectedFields),
        grant.purpose,
        grant.effectiveFrom,
        grant.expiresAt,
        JSON.stringify(grant.consent),
        grant.correlationId,
        grant.lifecycle.state,
        grant.lifecycle.version,
        grant.lifecycle.occurredAt,
        JSON.stringify(grant.lifecycle.appliedEventIds),
      ],
    );
    return decision;
  }

  async findById(shareGrantId: string): Promise<ShareGrant | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${GRANT_COLUMNS} from lighthouse.share_grants where share_grant_id = $1`,
      [shareGrantId],
    );
    const row = result.rows[0];
    return row ? grantFromRow(row) : null;
  }

  async findActiveGrantsForClient(clientUserRef: string): Promise<readonly ShareGrant[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${GRANT_COLUMNS} from lighthouse.share_grants
        where client_user_ref = $1 and state = 'active'
        order by created_at asc`,
      [clientUserRef],
    );
    return result.rows.map(grantFromRow);
  }

  async findActiveGrantsForRelationship(
    destinationRelationshipRef: string,
    recipientContext: string,
  ): Promise<readonly ShareGrant[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${GRANT_COLUMNS} from lighthouse.share_grants
        where destination_relationship_ref = $1
          and recipient_context = $2
          and state = 'active'
        order by created_at asc`,
      [destinationRelationshipRef, recipientContext],
    );
    return result.rows.map(grantFromRow);
  }

  async revoke(
    shareGrantId: string,
    clientUserRef: string,
    expectedVersion: number,
    now: Date,
  ): Promise<ShareGrantRevocation | null> {
    // Ownership and version are part of the WHERE clause, not a separate
    // check — so there is no window between "is this yours" and "revoke it".
    const result = await this.#client.query<Record<string, unknown>>(
      `update lighthouse.share_grants
          set state = 'revoked', revoked_at = $4, version = version + 1,
              updated_at = $4, lifecycle_occurred_at = $4
        where share_grant_id = $1
          and client_user_ref = $2
          and version = $3
          and state = 'active'
        returning share_grant_id, correlation_id`,
      [shareGrantId, clientUserRef, expectedVersion, now.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      shareGrantId: String(row.share_grant_id),
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
export class InMemoryShareGrantRepository implements ShareGrantRepository {
  readonly #grants = new Map<string, ShareGrant>();

  async create(input: CreateShareGrantInput): Promise<ShareCreationResult> {
    const decision = createShareGrant(input);
    if (!decision.ok) return decision;
    this.#grants.set(decision.grant.shareGrantId, decision.grant);
    return decision;
  }

  async findById(shareGrantId: string): Promise<ShareGrant | null> {
    return this.#grants.get(shareGrantId) ?? null;
  }

  async findActiveGrantsForClient(clientUserRef: string): Promise<readonly ShareGrant[]> {
    return [...this.#grants.values()].filter(
      (g) => g.clientUserRef === clientUserRef && g.lifecycle.state === "active",
    );
  }

  async findActiveGrantsForRelationship(
    destinationRelationshipRef: string,
    recipientContext: string,
  ): Promise<readonly ShareGrant[]> {
    return [...this.#grants.values()].filter(
      (g) =>
        g.destinationRelationshipRef === destinationRelationshipRef &&
        g.recipientContext === recipientContext &&
        g.lifecycle.state === "active",
    );
  }

  async revoke(
    shareGrantId: string,
    clientUserRef: string,
    expectedVersion: number,
    now: Date,
  ): Promise<ShareGrantRevocation | null> {
    const grant = this.#grants.get(shareGrantId);
    if (
      !grant ||
      grant.clientUserRef !== clientUserRef ||
      grant.lifecycle.version !== expectedVersion ||
      grant.lifecycle.state !== "active"
    ) {
      return null;
    }
    this.#grants.set(shareGrantId, {
      ...grant,
      lifecycle: {
        ...grant.lifecycle,
        state: "revoked",
        version: grant.lifecycle.version + 1,
        occurredAt: now.toISOString(),
      },
    });
    return {
      shareGrantId,
      revokedAt: now.toISOString(),
      correlationId: grant.correlationId,
    };
  }
}
