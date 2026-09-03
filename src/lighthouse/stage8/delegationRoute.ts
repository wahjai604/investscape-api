/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 8 HTTP surface — delegated client portfolio management (Mode D).
 *
 * DISABLED CAPABILITY. Nothing here is reachable until
 * `lighthouse.delegated_portfolio_management` is deliberately enabled, which
 * it is not. See DELEGATED_CLIENT_INVESTSCAPE_MANAGEMENT_SCOPE_V0.1.
 *
 * TWO DIFFERENT ACTORS, ONE FLOW, DELIBERATELY NOT SYMMETRIC
 *
 *   POST /delegation/requests        session-authenticated (the PROFESSIONAL)
 *   POST /delegation/accept          session-authenticated (the CLIENT)
 *   GET  /delegation/mandates        session-authenticated (either party, own only)
 *   POST /delegation/:id/revoke      session-authenticated (either party)
 *
 * THE SELF-DEALING GUARDS ARE THE MOST IMPORTANT PROPERTY OF THIS FILE.
 * `domain/delegationMandate.ts` enforces two of them independently — a
 * professional cannot name themselves as the client (guard #1, at request
 * creation), and a professional cannot accept a request as though they were
 * the client (guard #2, the decisive one, at acceptance, because acceptance
 * requires an authenticated session belonging to the CLIENT). This route
 * NEVER trusts a body-supplied actor ref for either role — `professionalUserRef`
 * on create and the acceptor's identity on accept both come only from
 * `req.lighthouseSession`.
 *
 * REPRESENTATION AUTHORITY DOES NOT EXIST YET
 *
 * `createDelegationRequest()` needs to know whether the professional currently
 * holds an active Relationship OS representation over this client, and
 * whether the professional is currently eligible to act as a delegate. No
 * store of either fact exists anywhere in this codebase yet. Rather than fake
 * a "yes", both checks are threaded through as constructor-injected functions
 * that DEFAULT TO ALWAYS RETURNING FALSE when not supplied — the same
 * fail-closed posture as `defaultProjectionSource()` in bootstrap.ts for
 * Stage 5. Replace `deps.checkRepresentationActive` / `deps.checkProfessionalEligible`
 * with real implementations once a representation-authority source exists.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import {
  DEFAULT_MANDATE_TTL_DAYS,
  generateMandateChallenge,
  type MandateDenial,
} from "../domain/delegationMandate.ts";
import { DELEGATED_PORTFOLIO_SCOPES, KNOWN_SCOPES } from "../domain/policy.ts";
import type { DelegationMandateRepository } from "./delegationRepository.ts";

const FLAG = "lighthouse.delegated_portfolio_management";

const createRequestSchema = z
  .object({
    clientUserRef: z.string().min(1).max(256),
    relationshipRef: z.string().min(1).max(256),
    representationRef: z.string().min(1).max(256),
    requestedScopes: z
      .array(z.enum(DELEGATED_PORTFOLIO_SCOPES))
      .min(1)
      .max(DELEGATED_PORTFOLIO_SCOPES.length),
    purpose: z.string().min(1).max(280),
    noticeVersion: z.string().min(1).max(64),
    ttlSeconds: z.number().int().min(60).max(30 * 24 * 3600).optional(),
  })
  .strict();

const acceptSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    challenge: z.string().min(1).max(512),
    portfolioRef: z.string().min(1).max(256),
    ttlDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

const revokeSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export interface DelegationRouteDependencies {
  readonly mandates: DelegationMandateRepository;
  readonly auditSink: AuditSink;
  /**
   * Whether the professional currently holds an active Relationship OS
   * representation over this client. NO REAL SOURCE EXISTS YET — defaults to
   * always false (fail closed). See the module comment above.
   */
  readonly checkRepresentationActive?: (
    professionalUserRef: string,
    clientUserRef: string,
    representationRef: string,
  ) => Promise<boolean>;
  /**
   * Whether the professional is currently eligible to act as a delegate.
   * NO REAL SOURCE EXISTS YET — defaults to always false (fail closed). See
   * the module comment above.
   */
  readonly checkProfessionalEligible?: (professionalUserRef: string) => Promise<boolean>;
  readonly now: () => Date;
  readonly newRequestId: () => string;
  readonly newMandateId: () => string;
  readonly env?: Record<string, string | undefined>;
}

/** Single opaque denial. Reasons are audited server-side, never returned. */
function deny(res: Response, status: number): void {
  res.status(status).json({ state: "denied" });
}

/**
 * Denials the caller is entitled to see the reason for, because the reason
 * describes only their OWN submitted data and reveals nothing about another
 * actor, another request, or a mandate's existence.
 */
const VALIDATION_SHAPED_DENIALS: ReadonlySet<MandateDenial> = new Set([
  "PROHIBITED_SCOPE_REQUESTED",
  "UNKNOWN_SCOPE_REQUESTED",
  "PURPOSE_REQUIRED",
  "NOTICE_VERSION_REQUIRED",
]);

export function createDelegationRouter(deps: DelegationRouteDependencies): Router {
  const router = Router();

  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  // Fail closed by default — see module comment.
  const representationIsActive = deps.checkRepresentationActive ?? (async () => false);
  const professionalIsEligible = deps.checkProfessionalEligible ?? (async () => false);

  // -------------------------------------------------------------------------
  // POST /delegation/requests — the PROFESSIONAL asks. May only ASK.
  // -------------------------------------------------------------------------
  router.post("/delegation/requests", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const correlationId = randomUUID();
    const requestId = deps.newRequestId();
    const challenge = generateMandateChallenge();

    const [repActive, proEligible] = await Promise.all([
      representationIsActive(
        session.actorRef,
        parsed.data.clientUserRef,
        parsed.data.representationRef,
      ),
      professionalIsEligible(session.actorRef),
    ]);

    const outcome = await deps.mandates.createRequest({
      requestId,
      // From the verified session. Never from the body.
      professionalUserRef: session.actorRef,
      clientUserRef: parsed.data.clientUserRef,
      relationshipRef: parsed.data.relationshipRef,
      representationRef: parsed.data.representationRef,
      representationIsActive: repActive,
      professionalIsEligible: proEligible,
      requestedScopes: parsed.data.requestedScopes,
      knownScopes: KNOWN_SCOPES,
      purpose: parsed.data.purpose,
      noticeVersion: parsed.data.noticeVersion,
      challenge,
      now,
      ttlSeconds: parsed.data.ttlSeconds,
      correlationId,
      isEnabled: true,
    });

    if (!outcome.ok) {
      await deps.auditSink.record({
        eventType: "stage8.request.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef,
        subjectId: parsed.data.clientUserRef,
        operatingContext: "professional_assisted",
        authority: { kind: "self" },
        purpose: "delegated_portfolio_management", scopes: parsed.data.requestedScopes,
        outcome: "denied",
        correlationId,
        metadata: { reason: outcome.reason },
      });

      if (VALIDATION_SHAPED_DENIALS.has(outcome.reason)) {
        res.status(400).json({ state: "invalid", reason: outcome.reason });
        return;
      }
      // SELF_DELEGATION_PROHIBITED, REPRESENTATION_NOT_ACTIVE,
      // PROFESSIONAL_NOT_ELIGIBLE, FEATURE_DISABLED: authorization failures.
      // Opaque, so the response cannot be used to probe another actor's
      // representation or eligibility state.
      deny(res, 403);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage8.request.created",
      occurredAt: now.toISOString(),
      actorId: session.actorRef,
      subjectId: parsed.data.clientUserRef,
      operatingContext: "professional_assisted",
      authority: { kind: "self" },
      purpose: "delegated_portfolio_management", scopes: parsed.data.requestedScopes,
      outcome: "allowed",
      correlationId,
      // The challenge is deliberately not in the audit metadata.
      metadata: { requestId },
    });

    res.status(201).json({
      state: "created",
      requestId,
      // Returned ONCE. Only the hash is persisted.
      challenge,
      expiresAt: outcome.request.expiresAt,
      correlationId,
    });
  });

  // -------------------------------------------------------------------------
  // POST /delegation/accept — the CLIENT accepts. This is where self-dealing
  // is finally impossible: acceptance requires an authenticated session
  // belonging to the CLIENT, compared against both the client and the
  // professional inside the domain layer.
  // -------------------------------------------------------------------------
  router.post("/delegation/accept", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const correlationId = randomUUID();
    const mandateId = deps.newMandateId();

    const outcome = await deps.mandates.acceptRequest({
      requestId: parsed.data.requestId,
      presentedChallenge: parsed.data.challenge,
      // From the verified session. Never from the body. `clientIsAuthenticated`
      // is implied by the session being present at all.
      authenticatedUserRef: session.actorRef,
      clientIsAuthenticated: true,
      portfolioRef: parsed.data.portfolioRef,
      mandateId,
      now,
      ttlDays: parsed.data.ttlDays ?? DEFAULT_MANDATE_TTL_DAYS,
      correlationId,
      isEnabled: true,
    });

    if (!outcome.ok) {
      await deps.auditSink.record({
        eventType: "stage8.mandate.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: session.actorRef,
        operatingContext: "delegated_client",
        authority: { kind: "self" },
        purpose: "delegated_portfolio_management", scopes: [],
        outcome: "denied",
        correlationId,
        metadata: { reason: outcome.reason },
      });
      // Single opaque denial. Telling a caller "expired" vs "already
      // consumed" vs "wrong challenge" vs "you are the professional" is a
      // free oracle for probing requests. No exceptions.
      deny(res, 403);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage8.mandate.accepted",
      occurredAt: now.toISOString(),
      actorId: session.actorRef,
      subjectId: session.actorRef,
      operatingContext: "delegated_client",
      authority: { kind: "delegation_mandate", grantId: outcome.mandate.mandateId },
      purpose: "delegated_portfolio_management", scopes: outcome.mandate.scopes,
      outcome: "allowed",
      correlationId,
      metadata: { mandateId: outcome.mandate.mandateId },
    });

    res.status(201).json({
      state: "active",
      mandateId: outcome.mandate.mandateId,
      scopes: outcome.mandate.scopes,
      effectiveFrom: outcome.mandate.effectiveFrom,
      expiresAt: outcome.mandate.expiresAt,
      version: outcome.mandate.lifecycle.version,
    });
  });

  // -------------------------------------------------------------------------
  // GET /delegation/mandates — the caller's OWN mandates, as either party.
  // Never anybody else's.
  // -------------------------------------------------------------------------
  router.get("/delegation/mandates", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    // Scoped by the session's actor ref inside each query. No parameter a
    // caller could supply widens this beyond their own involvement.
    const [asClient, asProfessional] = await Promise.all([
      deps.mandates.findActiveMandatesForClient(session.actorRef),
      deps.mandates.findActiveMandatesForProfessional(session.actorRef),
    ]);

    const seen = new Set<string>();
    const mandates = [...asClient, ...asProfessional].filter((m) => {
      if (seen.has(m.mandateId)) return false;
      seen.add(m.mandateId);
      return true;
    });

    res.status(200).json({
      state: "ok",
      mandates: mandates.map((m) => ({
        mandateId: m.mandateId,
        role: m.clientUserRef === session.actorRef ? "client" : "professional",
        scopes: m.scopes,
        purpose: m.purpose,
        effectiveFrom: m.effectiveFrom,
        expiresAt: m.expiresAt,
        state: m.lifecycle.state,
        version: m.lifecycle.version,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // POST /delegation/:mandateId/revoke — either party may end the mandate.
  // See the judgment call documented in delegationRepository.ts.
  // -------------------------------------------------------------------------
  router.post("/delegation/:mandateId/revoke", async (req: Request, res: Response) => {
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
    const rawId = req.params.mandateId;
    const mandateId = typeof rawId === "string" ? rawId : "";

    // Ownership (either party) is enforced inside the UPDATE's WHERE clause,
    // so a mandate belonging to neither party and a mandate that does not
    // exist are indistinguishable here — which is the intended behaviour.
    const revocation = await deps.mandates.revokeMandate(
      mandateId,
      session.actorRef,
      parsed.data.expectedVersion,
      now,
    );

    if (!revocation) {
      await deps.auditSink.record({
        eventType: "stage8.mandate.revoke_denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: null,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "delegated_portfolio_management", scopes: [],
        outcome: "denied",
        correlationId,
        metadata: { mandateId },
      });
      deny(res, 403);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage8.mandate.revoked",
      occurredAt: now.toISOString(),
      actorId: session.actorRef, subjectId: null,
      operatingContext: "personal",
      authority: { kind: "self" },
      purpose: "delegated_portfolio_management", scopes: [],
      outcome: "allowed",
      correlationId,
      metadata: { mandateId },
    });

    res.status(200).json({
      state: "revoked",
      mandateId: revocation.mandateId,
      revokedAt: revocation.revokedAt,
    });
  });

  return router;
}
