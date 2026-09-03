/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 4 HTTP surface — client-selected analysis sharing.
 *
 * PROVISIONAL. These request/response shapes have NOT been agreed with the
 * Relationship OS side. Nothing here is reachable until
 * LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING is deliberately enabled, which it
 * is not.
 *
 * ONE AUTHORITY, NOT TWO
 *
 * Unlike Stage 2, there is no service-authenticated leg here. Every route is
 * entirely client-initiated and session-authenticated:
 *
 *   POST /shares               session-authenticated (the client)
 *   GET  /shares                session-authenticated
 *   POST /shares/:id/revoke     session-authenticated
 *
 * The client is always the authenticated caller — never a body-supplied
 * `clientUserRef`. `createShareGrant()` already checks this in the domain
 * layer (`CONSENT_ACTOR_MISMATCH`), but the route also refuses outright if a
 * caller supplies a `clientUserRef` that does not match their own session,
 * so a mismatch is caught before it even reaches the domain decision.
 *
 * `linkIsActive` is NOT trusted from the request body. This route does not
 * yet have a link repository dependency to verify it against (that is a
 * caller-supplied dependency, wired in bootstrap.ts from the same
 * `LinkRepository` Stage 2 uses); it is threaded through as a dependency
 * callback so this router can query the actual link state rather than
 * accept a claim.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import type { ShareCreationDenial } from "../domain/shareGrant.ts";
import { SHAREABLE_FIELDS } from "../contracts/crossProduct.ts";
import type { ShareGrantRepository } from "./shareGrantRepository.ts";

const FLAG = "lighthouse.selected_analysis_sharing";

const MAX_ANALYSIS_IDS = 200; // schema-level ceiling; domain enforces the real MAX_ANALYSES_PER_GRANT
const MAX_STRING = 256;

const createShareSchema = z
  .object({
    crossProductLinkId: z.string().min(1).max(MAX_STRING),
    clientUserRef: z.string().min(1).max(MAX_STRING),
    destinationRelationshipRef: z.string().min(1).max(MAX_STRING),
    recipientContext: z.string().min(1).max(64),
    selectedAnalysisIds: z.array(z.string().min(1).max(MAX_STRING)).max(MAX_ANALYSIS_IDS),
    selectedFields: z.array(z.string().min(1).max(64)).max(SHAREABLE_FIELDS.length + 8),
    purpose: z.string().min(1).max(280),
    expiresAt: z.string().datetime().nullable(),
    noticeVersion: z.string().min(1).max(64),
    consentAffirmed: z.boolean(),
  })
  .strict();

const revokeSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export interface ShareGrantRouteDependencies {
  readonly grants: ShareGrantRepository;
  readonly auditSink: AuditSink;
  /** Resolves whether a cross-product link is currently active. */
  readonly isLinkActive: (crossProductLinkId: string, clientUserRef: string) => Promise<boolean>;
  readonly now: () => Date;
  readonly newShareGrantId: () => string;
  readonly env?: Record<string, string | undefined>;
}

/** Single opaque denial. Reasons are audited server-side, never returned. */
function deny(res: Response, status: number): void {
  res.status(status).json({ state: "denied" });
}

/**
 * Denials the caller is entitled to see the reason for, because the reason
 * describes only their OWN submitted data (too few fields, an unknown field,
 * an expiry in the past) and reveals nothing about another actor or another
 * grant's existence.
 */
const VALIDATION_SHAPED_DENIALS: ReadonlySet<ShareCreationDenial> = new Set([
  "NO_ANALYSES_SELECTED",
  "TOO_MANY_ANALYSES",
  "NO_FIELDS_SELECTED",
  "UNKNOWN_FIELD",
  "PURPOSE_REQUIRED",
  "CONSENT_NOT_AFFIRMED",
  "NOTICE_VERSION_REQUIRED",
  "EXPIRY_IN_PAST",
]);

export function createShareGrantRouter(deps: ShareGrantRouteDependencies): Router {
  const router = Router();

  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  // -------------------------------------------------------------------------
  // POST /shares — the client selects analyses, fields, a destination
  // relationship and a purpose, and affirmatively consents.
  // -------------------------------------------------------------------------
  router.post("/shares", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    const parsed = createShareSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    // The caller may only ever create a grant over their OWN analyses. A body
    // asserting a different client is refused here, before the domain layer
    // is even consulted — never trusted, whatever it claims.
    if (parsed.data.clientUserRef !== session.actorRef) {
      await deps.auditSink.record({
        eventType: "stage4.grant.denied",
        occurredAt: deps.now().toISOString(),
        actorId: session.actorRef, subjectId: null,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "selected_analysis_sharing", scopes: [], outcome: "denied",
        correlationId: null,
        metadata: { reason: "CONSENT_ACTOR_MISMATCH" },
      });
      deny(res, 403);
      return;
    }

    const now = deps.now();
    const correlationId = randomUUID();
    const shareGrantId = deps.newShareGrantId();

    const linkIsActive = await deps.isLinkActive(
      parsed.data.crossProductLinkId,
      session.actorRef,
    );

    const outcome = await deps.grants.create({
      shareGrantId,
      crossProductLinkId: parsed.data.crossProductLinkId,
      linkIsActive,
      clientUserRef: parsed.data.clientUserRef,
      // From the verified session. Never from the body.
      authenticatedUserRef: session.actorRef,
      destinationRelationshipRef: parsed.data.destinationRelationshipRef,
      recipientContext: parsed.data.recipientContext,
      selectedAnalysisIds: parsed.data.selectedAnalysisIds,
      selectedFields: parsed.data.selectedFields,
      purpose: parsed.data.purpose,
      expiresAt: parsed.data.expiresAt,
      noticeVersion: parsed.data.noticeVersion,
      consentAffirmed: parsed.data.consentAffirmed,
      now,
      correlationId,
      isEnabled: true,
    });

    if (!outcome.ok) {
      await deps.auditSink.record({
        eventType: "stage4.grant.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: session.actorRef,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "selected_analysis_sharing", scopes: [], outcome: "denied",
        correlationId,
        metadata: { reason: outcome.reason },
      });

      if (VALIDATION_SHAPED_DENIALS.has(outcome.reason)) {
        res.status(400).json({ state: "invalid", reason: outcome.reason });
        return;
      }
      // LINK_NOT_ACTIVE, CONSENT_ACTOR_MISMATCH, FEATURE_DISABLED: authorization
      // failures. Opaque, so the response cannot be used to probe another
      // actor's link state.
      deny(res, 403);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage4.grant.created",
      occurredAt: now.toISOString(),
      actorId: session.actorRef,
      subjectId: session.actorRef,
      operatingContext: "personal",
      authority: { kind: "self" },
      purpose: "selected_analysis_sharing", scopes: [], outcome: "allowed",
      correlationId,
      metadata: {
        shareGrantId: outcome.grant.shareGrantId,
        destinationRelationshipRef: outcome.grant.destinationRelationshipRef,
      },
    });

    res.status(201).json({
      state: "created",
      shareGrantId: outcome.grant.shareGrantId,
      destinationRelationshipRef: outcome.grant.destinationRelationshipRef,
      recipientContext: outcome.grant.recipientContext,
      selectedFields: outcome.grant.selectedFields,
      selectedAnalysisIds: outcome.grant.selectedAnalysisIds,
      purpose: outcome.grant.purpose,
      effectiveFrom: outcome.grant.effectiveFrom,
      expiresAt: outcome.grant.expiresAt,
      version: outcome.grant.lifecycle.version,
    });
  });

  // -------------------------------------------------------------------------
  // GET /shares — the caller's OWN grants. Never anybody else's.
  // -------------------------------------------------------------------------
  router.get("/shares", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    // Scoped by the session's actor ref inside the query. No parameter a
    // caller could supply widens this.
    const grants = await deps.grants.findActiveGrantsForClient(session.actorRef);

    res.status(200).json({
      state: "ok",
      grants: grants.map((grant) => ({
        shareGrantId: grant.shareGrantId,
        crossProductLinkId: grant.crossProductLinkId,
        destinationRelationshipRef: grant.destinationRelationshipRef,
        recipientContext: grant.recipientContext,
        selectedAnalysisIds: grant.selectedAnalysisIds,
        selectedFields: grant.selectedFields,
        purpose: grant.purpose,
        effectiveFrom: grant.effectiveFrom,
        expiresAt: grant.expiresAt,
        state: grant.lifecycle.state,
        version: grant.lifecycle.version,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // POST /shares/:shareGrantId/revoke
  // -------------------------------------------------------------------------
  router.post("/shares/:shareGrantId/revoke", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    const parsed = revokeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const correlationId = randomUUID();
    // Express types this as string | string[]; a repeated path segment would
    // yield an array. Coerce narrowly rather than casting.
    const rawId = req.params.shareGrantId;
    const shareGrantId = typeof rawId === "string" ? rawId : "";

    // Ownership is enforced inside the UPDATE's WHERE clause, so a grant
    // belonging to another actor and a grant that does not exist are
    // indistinguishable here — which is the intended behaviour.
    const revocation = await deps.grants.revoke(
      shareGrantId,
      session.actorRef,
      parsed.data.expectedVersion,
      now,
    );

    if (!revocation) {
      await deps.auditSink.record({
        eventType: "stage4.grant.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: session.actorRef,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "selected_analysis_sharing", scopes: [], outcome: "denied",
        correlationId,
        metadata: { shareGrantId },
      });
      deny(res, 403);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage4.grant.revoked",
      occurredAt: now.toISOString(),
      actorId: session.actorRef, subjectId: session.actorRef,
      operatingContext: "personal",
      authority: { kind: "self" },
      purpose: "selected_analysis_sharing", scopes: [], outcome: "allowed",
      correlationId,
      metadata: { shareGrantId },
    });

    res.status(200).json({
      state: "revoked",
      shareGrantId: revocation.shareGrantId,
      revokedAt: revocation.revokedAt,
    });
  });

  return router;
}
