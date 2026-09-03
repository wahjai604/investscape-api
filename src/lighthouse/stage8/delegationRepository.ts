/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 8 persistence — delegation requests and mandates (Mode D).
 *
 * `createDelegationRequest()` and `acceptDelegationMandate()` in
 * domain/delegationMandate.ts are pure functions: given an input they either
 * return a fully-formed value or a denial reason. This repository's job is to
 * run those decisions and, on success, persist the result — the domain layer
 * is not modified or second-guessed here. See that file's comments for why the
 * self-dealing guards are the single most important control in this stage.
 *
 * WHERE THE SINGLE-USE GUARANTEE ACTUALLY LIVES
 *
 * Exactly like Stage 2's `accept()`: `acceptDelegationMandate()` checks
 * `request.consumedAt !== null`, but a domain function cannot enforce
 * single-use on its own — two concurrent acceptances can both read
 * `consumedAt = null` and both pass. So `acceptRequest()` here runs inside a
 * transaction, loads the request `FOR UPDATE`, lets the domain layer decide,
 * and — only on success — claims the request with a CONDITIONAL update
 * (`where consumed_at is null`) and inserts the new mandate row, all in the
 * SAME transaction. The domain check remains a fast path and documentation of
 * intent, not the enforcement point.
 *
 * ORDER OF OPERATIONS: CHALLENGE COMPARE BEFORE CONSUME
 *
 * Same deliberate tradeoff as Stage 2 (see linkRepository.ts): a wrong
 * challenge does NOT burn the request. The domain function itself compares the
 * challenge before this repository claims the row, so that ordering is
 * inherited for free — nothing here needs to reorder anything.
 *
 * JUDGMENT CALL — WHO MAY REVOKE A MANDATE
 *
 * The domain/scope docs are not explicit about who may end an active mandate.
 * Given "the client remains the portfolio subject; the professional is the
 * actor" and that either party ending a delegation relationship is a
 * reasonable, conservative default (a professional stepping back, or a client
 * withdrawing consent, are both legitimate on their own), `revokeMandate()`
 * allows EITHER `professionalUserRef` OR `clientUserRef` to match the acting
 * actor. This is a judgment call, not a decision pinned anywhere in the scope
 * doc — revisit if product/legal review says otherwise.
 */

import {
  acceptDelegationMandate,
  createDelegationRequest,
  type AcceptMandateInput,
  type CreateRequestInput,
  type DelegationMandate,
  type DelegationRequest,
  type MandateDenial,
} from "../domain/delegationMandate.ts";
import { MANDATE_LIFECYCLE } from "../domain/lifecycle.ts";
import type { SqlClient, TransactionalSqlClient } from "../persistence/types.ts";

export type RequestCreationResult =
  | { readonly ok: true; readonly request: DelegationRequest }
  | { readonly ok: false; readonly reason: MandateDenial };

export interface AcceptRequestInput {
  readonly requestId: string;
  readonly presentedChallenge: string;
  /** From the verified session. Never from the request body. */
  readonly authenticatedUserRef: string;
  readonly clientIsAuthenticated: boolean;
  readonly portfolioRef: string;
  readonly mandateId: string;
  readonly now: Date;
  readonly ttlDays?: number;
  readonly correlationId: string;
  readonly isEnabled: boolean;
  readonly assistedConsent?: { readonly requested: boolean; readonly enabled: boolean };
}

export type AcceptOutcome =
  | { readonly ok: true; readonly mandate: DelegationMandate }
  | { readonly ok: false; readonly reason: MandateDenial };

export interface MandateRevocation {
  readonly mandateId: string;
  readonly revokedAt: string;
  readonly correlationId: string;
}

export interface DelegationMandateRepository {
  /** Runs the domain decision and persists the request on success. */
  createRequest(input: CreateRequestInput): Promise<RequestCreationResult>;
  findRequestById(requestId: string): Promise<DelegationRequest | null>;
  /** Atomic: load request FOR UPDATE, decide, claim request, insert mandate. */
  acceptRequest(input: AcceptRequestInput): Promise<AcceptOutcome>;
  findMandateById(mandateId: string): Promise<DelegationMandate | null>;
  findActiveMandatesForClient(clientUserRef: string): Promise<readonly DelegationMandate[]>;
  findActiveMandatesForProfessional(
    professionalUserRef: string,
  ): Promise<readonly DelegationMandate[]>;
  /**
   * Compare-and-set revoke. Ownership and version are enforced inside the
   * WHERE clause. Either the professional or the client may revoke (see the
   * judgment call documented above). Returns null for "not found", "not
   * yours", "stale version" and "already terminal" alike — indistinguishable
   * on purpose.
   */
  revokeMandate(
    mandateId: string,
    actorRef: string,
    expectedVersion: number,
    now: Date,
  ): Promise<MandateRevocation | null>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function parseJsonArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value as readonly string[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as readonly string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function requestFromRow(row: Record<string, unknown>): DelegationRequest {
  return {
    requestId: String(row.request_id),
    professionalUserRef: String(row.professional_user_ref),
    clientUserRef: String(row.client_user_ref),
    relationshipRef: String(row.relationship_ref),
    representationRef: String(row.representation_ref),
    requestedScopes: parseJsonArray(row.requested_scopes),
    purpose: String(row.purpose),
    noticeVersion: String(row.notice_version),
    challengeHash: String(row.challenge_hash),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    correlationId: String(row.correlation_id),
    consumedAt: row.consumed_at ? new Date(row.consumed_at as string).toISOString() : null,
  };
}

function mandateFromRow(row: Record<string, unknown>): DelegationMandate {
  return {
    mandateId: String(row.mandate_id),
    professionalUserRef: String(row.professional_user_ref),
    clientUserRef: String(row.client_user_ref),
    relationshipRef: String(row.relationship_ref),
    representationRef: String(row.representation_ref),
    portfolioRef: String(row.portfolio_ref),
    scopes: parseJsonArray(row.scopes),
    purpose: String(row.purpose),
    noticeVersion: String(row.notice_version),
    effectiveFrom: new Date(row.effective_from as string).toISOString(),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    acceptedByClientAt: new Date(row.accepted_by_client_at as string).toISOString(),
    correlationId: String(row.correlation_id),
    lifecycle: {
      state: row.state as DelegationMandate["lifecycle"]["state"],
      version: Number(row.version),
      occurredAt: new Date(row.lifecycle_occurred_at as string).toISOString(),
      appliedEventIds: parseJsonArray(row.applied_event_ids),
    },
  };
}

const REQUEST_COLUMNS = `request_id, professional_user_ref, client_user_ref,
  relationship_ref, representation_ref, requested_scopes, purpose,
  notice_version, challenge_hash, expires_at, correlation_id, consumed_at`;

const MANDATE_COLUMNS = `mandate_id, professional_user_ref, client_user_ref,
  relationship_ref, representation_ref, portfolio_ref, scopes, purpose,
  notice_version, effective_from, expires_at, accepted_by_client_at,
  correlation_id, state, version, lifecycle_occurred_at, applied_event_ids`;

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export class SqlDelegationMandateRepository implements DelegationMandateRepository {
  readonly #client: TransactionalSqlClient;

  constructor(client: TransactionalSqlClient) {
    this.#client = client;
  }

  async createRequest(input: CreateRequestInput): Promise<RequestCreationResult> {
    const decision = createDelegationRequest(input);
    if (!decision.ok) return decision;

    const request = decision.value;
    await this.#client.query(
      `insert into lighthouse.delegation_requests
         (request_id, professional_user_ref, client_user_ref, relationship_ref,
          representation_ref, requested_scopes, purpose, notice_version,
          challenge_hash, expires_at, correlation_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        request.requestId,
        request.professionalUserRef,
        request.clientUserRef,
        request.relationshipRef,
        request.representationRef,
        JSON.stringify(request.requestedScopes),
        request.purpose,
        request.noticeVersion,
        request.challengeHash,
        request.expiresAt,
        request.correlationId,
      ],
    );
    return { ok: true, request };
  }

  async findRequestById(requestId: string): Promise<DelegationRequest | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${REQUEST_COLUMNS} from lighthouse.delegation_requests where request_id = $1`,
      [requestId],
    );
    const row = result.rows[0];
    return row ? requestFromRow(row) : null;
  }

  async acceptRequest(input: AcceptRequestInput): Promise<AcceptOutcome> {
    return this.#client.transaction(async (tx: SqlClient) => {
      // `for update` serialises concurrent acceptances of the SAME request.
      // The conditional update below is still required — row locking alone
      // does not express "only if not already consumed".
      const found = await tx.query<Record<string, unknown>>(
        `select ${REQUEST_COLUMNS} from lighthouse.delegation_requests
          where request_id = $1
          for update`,
        [input.requestId],
      );
      const request = found.rows[0] ? requestFromRow(found.rows[0]) : null;

      const acceptInput: AcceptMandateInput = {
        request,
        presentedChallenge: input.presentedChallenge,
        authenticatedUserRef: input.authenticatedUserRef,
        clientIsAuthenticated: input.clientIsAuthenticated,
        portfolioRef: input.portfolioRef,
        mandateId: input.mandateId,
        now: input.now,
        ttlDays: input.ttlDays,
        correlationId: input.correlationId,
        isEnabled: input.isEnabled,
        assistedConsent: input.assistedConsent,
      };
      const decision = acceptDelegationMandate(acceptInput);
      if (!decision.ok) return decision;

      // Claim the request. THIS is the single-use enforcement point.
      const claimed = await tx.query(
        `update lighthouse.delegation_requests
            set consumed_at = $2
          where request_id = $1 and consumed_at is null`,
        [input.requestId, input.now.toISOString()],
      );
      if (claimed.rowCount !== 1) {
        return { ok: false, reason: "REQUEST_ALREADY_CONSUMED" as const };
      }

      const mandate = decision.value;
      await tx.query(
        `insert into lighthouse.delegation_mandates
           (mandate_id, professional_user_ref, client_user_ref, relationship_ref,
            representation_ref, portfolio_ref, scopes, purpose, notice_version,
            effective_from, expires_at, accepted_by_client_at, correlation_id,
            state, version, lifecycle_occurred_at, applied_event_ids)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          mandate.mandateId,
          mandate.professionalUserRef,
          mandate.clientUserRef,
          mandate.relationshipRef,
          mandate.representationRef,
          mandate.portfolioRef,
          JSON.stringify(mandate.scopes),
          mandate.purpose,
          mandate.noticeVersion,
          mandate.effectiveFrom,
          mandate.expiresAt,
          mandate.acceptedByClientAt,
          mandate.correlationId,
          mandate.lifecycle.state,
          mandate.lifecycle.version,
          mandate.lifecycle.occurredAt,
          JSON.stringify(mandate.lifecycle.appliedEventIds),
        ],
      );

      return { ok: true as const, mandate };
    });
  }

  async findMandateById(mandateId: string): Promise<DelegationMandate | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${MANDATE_COLUMNS} from lighthouse.delegation_mandates where mandate_id = $1`,
      [mandateId],
    );
    const row = result.rows[0];
    return row ? mandateFromRow(row) : null;
  }

  async findActiveMandatesForClient(
    clientUserRef: string,
  ): Promise<readonly DelegationMandate[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${MANDATE_COLUMNS} from lighthouse.delegation_mandates
        where client_user_ref = $1 and state in ('active','suspended')
        order by created_at asc`,
      [clientUserRef],
    );
    return result.rows.map(mandateFromRow);
  }

  async findActiveMandatesForProfessional(
    professionalUserRef: string,
  ): Promise<readonly DelegationMandate[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${MANDATE_COLUMNS} from lighthouse.delegation_mandates
        where professional_user_ref = $1 and state in ('active','suspended')
        order by created_at asc`,
      [professionalUserRef],
    );
    return result.rows.map(mandateFromRow);
  }

  async revokeMandate(
    mandateId: string,
    actorRef: string,
    expectedVersion: number,
    now: Date,
  ): Promise<MandateRevocation | null> {
    // Ownership (either party) and version are part of the WHERE clause, not
    // a separate check — no window between "is this yours" and "revoke it".
    const result = await this.#client.query<Record<string, unknown>>(
      `update lighthouse.delegation_mandates
          set state = 'revoked', revoked_at = $4, version = version + 1,
              updated_at = $4, lifecycle_occurred_at = $4
        where mandate_id = $1
          and (professional_user_ref = $2 or client_user_ref = $2)
          and version = $3
          and state in ('active','suspended')
        returning mandate_id, correlation_id`,
      [mandateId, actorRef, expectedVersion, now.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      mandateId: String(row.mandate_id),
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
 * threaded event loop makes the claim below atomic within one process only;
 * it provides no guarantee across processes. Exists so domain and route tests
 * can run without a database, not as a deployable backend.
 */
export class InMemoryDelegationMandateRepository implements DelegationMandateRepository {
  readonly #requests = new Map<string, DelegationRequest>();
  readonly #mandates = new Map<string, DelegationMandate>();

  async createRequest(input: CreateRequestInput): Promise<RequestCreationResult> {
    const decision = createDelegationRequest(input);
    if (!decision.ok) return decision;
    this.#requests.set(decision.value.requestId, decision.value);
    return { ok: true, request: decision.value };
  }

  async findRequestById(requestId: string): Promise<DelegationRequest | null> {
    return this.#requests.get(requestId) ?? null;
  }

  async acceptRequest(input: AcceptRequestInput): Promise<AcceptOutcome> {
    const request = this.#requests.get(input.requestId) ?? null;

    const decision = acceptDelegationMandate({
      request,
      presentedChallenge: input.presentedChallenge,
      authenticatedUserRef: input.authenticatedUserRef,
      clientIsAuthenticated: input.clientIsAuthenticated,
      portfolioRef: input.portfolioRef,
      mandateId: input.mandateId,
      now: input.now,
      ttlDays: input.ttlDays,
      correlationId: input.correlationId,
      isEnabled: input.isEnabled,
      assistedConsent: input.assistedConsent,
    });
    if (!decision.ok) return decision;

    // Claim, mirroring the conditional update.
    const current = this.#requests.get(input.requestId);
    if (!current || current.consumedAt !== null) {
      return { ok: false, reason: "REQUEST_ALREADY_CONSUMED" };
    }
    this.#requests.set(input.requestId, {
      ...current,
      consumedAt: input.now.toISOString(),
    });

    this.#mandates.set(decision.value.mandateId, decision.value);
    return { ok: true, mandate: decision.value };
  }

  async findMandateById(mandateId: string): Promise<DelegationMandate | null> {
    return this.#mandates.get(mandateId) ?? null;
  }

  async findActiveMandatesForClient(
    clientUserRef: string,
  ): Promise<readonly DelegationMandate[]> {
    return [...this.#mandates.values()].filter(
      (m) =>
        m.clientUserRef === clientUserRef &&
        !MANDATE_LIFECYCLE.terminal.includes(m.lifecycle.state),
    );
  }

  async findActiveMandatesForProfessional(
    professionalUserRef: string,
  ): Promise<readonly DelegationMandate[]> {
    return [...this.#mandates.values()].filter(
      (m) =>
        m.professionalUserRef === professionalUserRef &&
        !MANDATE_LIFECYCLE.terminal.includes(m.lifecycle.state),
    );
  }

  async revokeMandate(
    mandateId: string,
    actorRef: string,
    expectedVersion: number,
    now: Date,
  ): Promise<MandateRevocation | null> {
    const mandate = this.#mandates.get(mandateId);
    if (
      !mandate ||
      (mandate.professionalUserRef !== actorRef && mandate.clientUserRef !== actorRef) ||
      mandate.lifecycle.version !== expectedVersion ||
      MANDATE_LIFECYCLE.terminal.includes(mandate.lifecycle.state)
    ) {
      return null;
    }
    this.#mandates.set(mandateId, {
      ...mandate,
      lifecycle: {
        ...mandate.lifecycle,
        state: "revoked",
        version: mandate.lifecycle.version + 1,
        occurredAt: now.toISOString(),
      },
    });
    return {
      mandateId,
      revokedAt: now.toISOString(),
      correlationId: mandate.correlationId,
    };
  }
}
