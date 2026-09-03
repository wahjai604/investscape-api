/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 2 persistence — link invitations and confirmed cross-product links.
 *
 * WHERE THE SINGLE-USE GUARANTEE ACTUALLY LIVES
 *
 * `acceptLinkInvitation()` in domain/crossProductLink.ts checks
 * `invitation.consumedAt !== null`, but a domain function cannot enforce
 * single-use on its own: two concurrent requests can both read `consumedAt =
 * null`, both pass the check, and both create a link. The guarantee has to be
 * enforced by the database.
 *
 * So the accept path here runs inside a transaction and claims the invitation
 * with a CONDITIONAL update (`where consumed_at is null`). Exactly one
 * concurrent caller can observe `rowCount === 1`; the loser is told the
 * invitation was already consumed. The domain check remains as a fast path and
 * as documentation of intent — it is not the enforcement point, and a comment
 * in the domain file should not be read as claiming otherwise.
 *
 * ORDER OF OPERATIONS: CHALLENGE COMPARE BEFORE CONSUME
 *
 * A deliberate choice with a real tradeoff:
 *
 *   Compare-then-consume (what this does): a wrong challenge does NOT burn the
 *   invitation. Cost: an attacker who learns an invitationId may attempt the
 *   challenge repeatedly until it expires.
 *
 *   Consume-then-compare: brute force becomes impossible, but anyone who learns
 *   an invitationId can destroy a pending invitation on demand.
 *
 * Compare-first wins because the challenge is 256 bits of CSPRNG output — brute
 * force inside a 15-minute TTL is not a real threat — whereas invitation
 * destruction is a real, trivially-executed availability harm. Rate limiting on
 * the accept endpoint bounds the attempt count further. If the challenge is
 * ever shortened, this decision must be revisited.
 */

import { randomUUID } from "node:crypto";
import {
  acceptLinkInvitation,
  type AcceptanceDenial,
  type CrossProductLink,
  type LinkInvitation,
  type LinkTombstone,
} from "../domain/crossProductLink.ts";
import { LINK_LIFECYCLE } from "../domain/lifecycle.ts";
import type { SqlClient, TransactionalSqlClient } from "../persistence/types.ts";

export interface AcceptRequest {
  readonly invitationId: string;
  readonly presentedChallenge: string;
  /** From the verified session. Never from the request body. */
  readonly investscapeActorRef: string;
  readonly correlationId: string;
  readonly now: Date;
  readonly isEnabled: boolean;
}

export type AcceptOutcome =
  | { readonly ok: true; readonly link: CrossProductLink; readonly created: boolean }
  | { readonly ok: false; readonly reason: AcceptanceDenial };

export interface LinkRepository {
  createInvitation(invitation: LinkInvitation): Promise<void>;
  findInvitation(invitationId: string): Promise<LinkInvitation | null>;
  /** Atomic: compare challenge, claim invitation, create link. */
  accept(request: AcceptRequest): Promise<AcceptOutcome>;
  findActiveLinksForActor(actorRef: string): Promise<readonly CrossProductLink[]>;
  findLinkById(crossProductLinkId: string): Promise<CrossProductLink | null>;
  /**
   * Revokes a link. `expectedVersion` makes this a compare-and-set so a stale
   * client cannot revoke a link that has since changed underneath it.
   */
  revokeLink(
    crossProductLinkId: string,
    actorRef: string,
    now: Date,
    expectedVersion: number,
  ): Promise<LinkTombstone | null>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function invitationFromRow(row: Record<string, unknown>): LinkInvitation {
  return {
    invitationId: String(row.invitation_id),
    challengeHash: String(row.challenge_hash),
    relationshipOsPersonRef: String(row.relationship_os_person_ref),
    relationshipRef: String(row.relationship_ref),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    noticeVersion: String(row.notice_version),
    correlationId: String(row.correlation_id),
    consumedAt: row.consumed_at ? new Date(row.consumed_at as string).toISOString() : null,
  };
}

function linkFromRow(row: Record<string, unknown>): CrossProductLink {
  return {
    crossProductLinkId: String(row.cross_product_link_id),
    relationshipOsPersonRef: String(row.relationship_os_person_ref),
    investscapeUserRef: String(row.investscape_actor_ref),
    relationshipRef: String(row.relationship_ref),
    noticeVersion: String(row.notice_version),
    acceptedAt: row.accepted_at
      ? new Date(row.accepted_at as string).toISOString()
      : new Date(row.created_at as string).toISOString(),
    correlationId: String(row.correlation_id),
    lifecycle: {
      state: row.state as CrossProductLink["lifecycle"]["state"],
      version: Number(row.version),
      occurredAt: new Date(row.updated_at as string).toISOString(),
      appliedEventIds: [],
    },
  };
}

const LINK_COLUMNS = `cross_product_link_id, relationship_os_person_ref,
  investscape_actor_ref, relationship_ref, state, version, notice_version,
  accepted_at, revoked_at, correlation_id, created_at, updated_at`;

const INVITATION_COLUMNS = `invitation_id, relationship_os_person_ref, relationship_ref,
  challenge_hash, notice_version, expires_at, consumed_at, consumed_by_actor_ref,
  correlation_id, created_at`;

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export class SqlLinkRepository implements LinkRepository {
  readonly #client: TransactionalSqlClient;

  constructor(client: TransactionalSqlClient) {
    this.#client = client;
  }

  async createInvitation(invitation: LinkInvitation): Promise<void> {
    await this.#client.query(
      `insert into lighthouse.link_invitations
         (invitation_id, relationship_os_person_ref, relationship_ref,
          challenge_hash, notice_version, expires_at, correlation_id)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        invitation.invitationId,
        invitation.relationshipOsPersonRef,
        invitation.relationshipRef,
        invitation.challengeHash,
        invitation.noticeVersion,
        invitation.expiresAt,
        invitation.correlationId,
      ],
    );
  }

  async findInvitation(invitationId: string): Promise<LinkInvitation | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${INVITATION_COLUMNS} from lighthouse.link_invitations
        where invitation_id = $1`,
      [invitationId],
    );
    const row = result.rows[0];
    return row ? invitationFromRow(row) : null;
  }

  async accept(request: AcceptRequest): Promise<AcceptOutcome> {
    return this.#client.transaction(async (tx: SqlClient) => {
      // `for update` serialises concurrent acceptances of the SAME invitation.
      // The conditional update below is still required — row locking alone does
      // not express "only if not already consumed".
      const found = await tx.query<Record<string, unknown>>(
        `select ${INVITATION_COLUMNS} from lighthouse.link_invitations
          where invitation_id = $1
          for update`,
        [request.invitationId],
      );
      const invitation = found.rows[0] ? invitationFromRow(found.rows[0]) : null;

      // Domain decides. Note the dual-authentication proof below: the
      // InvestScape side is proven by the verified session on this request; the
      // Relationship OS side is proven by the invitation's own existence, which
      // could only have been created through a service-authenticated call from
      // Relationship OS asserting it authenticated that person. If invitation
      // creation ever becomes reachable without service auth, this proof breaks.
      const decision = acceptLinkInvitation({
        invitation,
        presentedChallenge: request.presentedChallenge,
        proof: {
          investscapeUserRef: request.investscapeActorRef,
          investscapeUserAuthenticated: true,
          relationshipOsPersonRef: invitation?.relationshipOsPersonRef ?? "",
          relationshipOsPersonAuthenticated: invitation !== null,
        },
        now: request.now,
        newLinkId: () => randomUUID(),
        correlationId: request.correlationId,
        isEnabled: request.isEnabled,
      });

      if (!decision.ok) return decision;

      // Claim the invitation. THIS is the single-use enforcement point.
      const claimed = await tx.query(
        `update lighthouse.link_invitations
            set consumed_at = $2, consumed_by_actor_ref = $3
          where invitation_id = $1 and consumed_at is null`,
        [request.invitationId, request.now.toISOString(), request.investscapeActorRef],
      );
      if (claimed.rowCount !== 1) {
        return { ok: false, reason: "INVITATION_ALREADY_CONSUMED" as const };
      }

      const link = decision.link;
      const inserted = await tx.query<Record<string, unknown>>(
        `insert into lighthouse.cross_product_links
           (cross_product_link_id, relationship_os_person_ref, investscape_actor_ref,
            relationship_ref, state, version, notice_version, accepted_at, correlation_id)
         values ($1,$2,$3,$4,'active',1,$5,$6,$7)
         on conflict do nothing
         returning ${LINK_COLUMNS}`,
        [
          link.crossProductLinkId,
          link.relationshipOsPersonRef,
          link.investscapeUserRef,
          link.relationshipRef,
          link.noticeVersion,
          link.acceptedAt,
          link.correlationId,
        ],
      );

      if (inserted.rowCount === 1 && inserted.rows[0]) {
        return { ok: true as const, link: linkFromRow(inserted.rows[0]), created: true };
      }

      // The partial unique index `uq_cross_product_links_active_pair` rejected
      // this: an active link for the same (person, actor) pair already exists.
      // That is a benign duplicate-accept, not an error — adopt the existing row
      // rather than reporting a failure the user cannot act on.
      const existing = await tx.query<Record<string, unknown>>(
        `select ${LINK_COLUMNS} from lighthouse.cross_product_links
          where relationship_os_person_ref = $1 and investscape_actor_ref = $2
            and state in ('pending','active','suspended')`,
        [link.relationshipOsPersonRef, link.investscapeUserRef],
      );
      const row = existing.rows[0];
      if (!row) {
        // Insert refused but no conflicting row is visible. Do not invent a
        // success; surface it as not-found so the caller retries cleanly.
        return { ok: false, reason: "INVITATION_NOT_FOUND" as const };
      }
      return { ok: true as const, link: linkFromRow(row), created: false };
    });
  }

  async findActiveLinksForActor(actorRef: string): Promise<readonly CrossProductLink[]> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${LINK_COLUMNS} from lighthouse.cross_product_links
        where investscape_actor_ref = $1 and state in ('pending','active','suspended')
        order by created_at asc`,
      [actorRef],
    );
    return result.rows.map(linkFromRow);
  }

  async findLinkById(crossProductLinkId: string): Promise<CrossProductLink | null> {
    const result = await this.#client.query<Record<string, unknown>>(
      `select ${LINK_COLUMNS} from lighthouse.cross_product_links
        where cross_product_link_id = $1`,
      [crossProductLinkId],
    );
    const row = result.rows[0];
    return row ? linkFromRow(row) : null;
  }

  async revokeLink(
    crossProductLinkId: string,
    actorRef: string,
    now: Date,
    expectedVersion: number,
  ): Promise<LinkTombstone | null> {
    // Ownership is part of the WHERE clause, not a separate check — so there is
    // no window between "is this yours" and "revoke it", and no code path that
    // revokes a link belonging to someone else.
    const result = await this.#client.query<Record<string, unknown>>(
      `update lighthouse.cross_product_links
          set state = 'revoked', revoked_at = $3, version = version + 1, updated_at = $3
        where cross_product_link_id = $1
          and investscape_actor_ref = $2
          and version = $4
          and state in ('pending','active','suspended')
        returning ${LINK_COLUMNS}`,
      [crossProductLinkId, actorRef, now.toISOString(), expectedVersion],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      crossProductLinkId,
      tombstonedAt: now.toISOString(),
      reason: "unlinked",
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
 * it provides no guarantee across processes. It exists so domain and route
 * tests can run without a database, not as a deployable backend.
 */
export class InMemoryLinkRepository implements LinkRepository {
  readonly #invitations = new Map<string, LinkInvitation>();
  readonly #links = new Map<string, CrossProductLink>();

  async createInvitation(invitation: LinkInvitation): Promise<void> {
    this.#invitations.set(invitation.invitationId, invitation);
  }

  async findInvitation(invitationId: string): Promise<LinkInvitation | null> {
    return this.#invitations.get(invitationId) ?? null;
  }

  async accept(request: AcceptRequest): Promise<AcceptOutcome> {
    const invitation = this.#invitations.get(request.invitationId) ?? null;
    const decision = acceptLinkInvitation({
      invitation,
      presentedChallenge: request.presentedChallenge,
      proof: {
        investscapeUserRef: request.investscapeActorRef,
        investscapeUserAuthenticated: true,
        relationshipOsPersonRef: invitation?.relationshipOsPersonRef ?? "",
        relationshipOsPersonAuthenticated: invitation !== null,
      },
      now: request.now,
      newLinkId: () => randomUUID(),
      correlationId: request.correlationId,
      isEnabled: request.isEnabled,
    });
    if (!decision.ok) return decision;

    // Claim, mirroring the conditional update.
    const current = this.#invitations.get(request.invitationId);
    if (!current || current.consumedAt !== null) {
      return { ok: false, reason: "INVITATION_ALREADY_CONSUMED" };
    }
    this.#invitations.set(request.invitationId, {
      ...current,
      consumedAt: request.now.toISOString(),
    });

    const duplicate = [...this.#links.values()].find(
      (l) =>
        l.relationshipOsPersonRef === decision.link.relationshipOsPersonRef &&
        l.investscapeUserRef === decision.link.investscapeUserRef &&
        LINK_LIFECYCLE.terminal.includes(l.lifecycle.state) === false,
    );
    if (duplicate) return { ok: true, link: duplicate, created: false };

    this.#links.set(decision.link.crossProductLinkId, decision.link);
    return { ok: true, link: decision.link, created: true };
  }

  async findActiveLinksForActor(actorRef: string): Promise<readonly CrossProductLink[]> {
    return [...this.#links.values()].filter(
      (l) =>
        l.investscapeUserRef === actorRef &&
        LINK_LIFECYCLE.terminal.includes(l.lifecycle.state) === false,
    );
  }

  async findLinkById(crossProductLinkId: string): Promise<CrossProductLink | null> {
    return this.#links.get(crossProductLinkId) ?? null;
  }

  async revokeLink(
    crossProductLinkId: string,
    actorRef: string,
    now: Date,
    expectedVersion: number,
  ): Promise<LinkTombstone | null> {
    const link = this.#links.get(crossProductLinkId);
    if (
      !link ||
      link.investscapeUserRef !== actorRef ||
      link.lifecycle.version !== expectedVersion ||
      LINK_LIFECYCLE.terminal.includes(link.lifecycle.state)
    ) {
      return null;
    }
    this.#links.set(crossProductLinkId, {
      ...link,
      lifecycle: {
        ...link.lifecycle,
        state: "revoked",
        version: link.lifecycle.version + 1,
        occurredAt: now.toISOString(),
      },
    });
    return {
      crossProductLinkId,
      tombstonedAt: now.toISOString(),
      reason: "unlinked",
      correlationId: link.correlationId,
    };
  }
}
