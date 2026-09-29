/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Mounted by bootstrap.ts behind `featureGate` + `requireSession`; with
 * LIGHTHOUSE_FF_STAGE1_LAUNCH_RECEIVER off (the default) every request is 503.
 * Enabling it additionally requires:
 *   1. a database and secret manager in this service;
 *   2. Relationship OS shipping a launch context that NAMES ITS INITIATOR
 *      (proposed investscape-launch-context.v2). A v1 launch can never be
 *      bound to an owner and is refused;
 *   3. the header-name documentation discrepancy being resolved.
 *
 * ROUTES
 *   POST /launch/handoffs          no session. Seals the code for a sign-in
 *                                  round trip; see launchHandoff.ts.
 *   POST /launch/handoffs/redeem   session. Claims the handoff and redeems.
 *   POST /launch/redeem            session. Direct redemption when the caller
 *                                  already holds both a session and the code.
 * Both redeem routes share one completion path (`completeRedemption`).
 *
 * OWNERSHIP: login plus possession of the launch link is NOT enough. See
 * launchOwnership.ts. The analysis is bound only to the InvestScape actor
 * holding an ACTIVE cross-product link to the Relationship OS person the
 * signed redemption response names as initiator.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import type { AnalysisBindingRepository } from "./analysisBinding.ts";
import { LAUNCH_OPERATING_CONTEXT, bindingFromLaunchContext } from "./analysisBinding.ts";
import type { LinkRepository } from "../stage2/linkRepository.ts";
import { actorCanBeLaunchInitiator, decideLaunchOwnership } from "./launchOwnership.ts";
import {
  generateHandoffToken,
  hashHandoffToken,
  openHandoff,
  sealHandoff,
  type LaunchHandoffRepository,
} from "./launchHandoff.ts";
import {
  type RedemptionConfig, type RedemptionDependencies, redeemLaunchSession,
} from "./redemptionClient.ts";

/**
 * The browser sends ONLY these two values. Note what is absent: modules,
 * scopes, propertyId, tier, relationship. Anything else in the body is ignored
 * — authority comes from the redemption response, never from the client.
 */
const landingRequestSchema = z
  .object({
    // UUID shape: the launch session id is persisted in a uuid column by the
    // handoff table and Relationship OS itself rejects anything else.
    launchSessionId: z
      .string()
      .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
    code: z.string().min(1).max(512),
  })
  .strict();

/** 32 random bytes, base64url, no padding: exactly 43 characters. */
const handoffRedeemSchema = z
  .object({ handoffToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();

export interface LaunchRouteDependencies {
  readonly config: Partial<RedemptionConfig> | null;
  readonly redemption: RedemptionDependencies;
  readonly bindings: AnalysisBindingRepository;
  /** The Stage 2 link store: the only evidence that RoS person == IS actor. */
  readonly links: Pick<LinkRepository, "findActiveLinksForActor">;
  /** Short-lived sealed codes awaiting the professional's sign-in. */
  readonly handoffs: LaunchHandoffRepository;
  /**
   * Where the landing page sends the browser after sealing a handoff: the
   * InvestScape app page that signs the professional in and calls
   * /launch/handoffs/redeem. Non-secret configuration. Absent => handoff
   * creation answers 503 before storing anything.
   */
  readonly appResumeUrl: string | null;
  readonly newHandoffId: () => string;
  readonly auditSink: AuditSink;
  readonly newAnalysisId: () => string;
  readonly now: () => Date;
  readonly env?: Record<string, string | undefined>;
}

const FLAG = "lighthouse.stage1_launch_receiver";

export function createLaunchRouter(deps: LaunchRouteDependencies): Router {
  const router = Router();

  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  /** Pre-redemption gate shared by both redeem routes. */
  async function refuseUnlinkedActor(actorRef: string, res: Response) {
    const actorLinks = await deps.links.findActiveLinksForActor(actorRef);
    if (actorCanBeLaunchInitiator(actorLinks)) return actorLinks;
    await deps.auditSink.record({
      eventType: "stage1.redemption.denied",
      occurredAt: deps.now().toISOString(),
      actorId: actorRef, subjectId: null, operatingContext: LAUNCH_OPERATING_CONTEXT,
      authority: { kind: "service_identity" },
      purpose: "property_analysis", scopes: [], outcome: "denied",
      correlationId: null,
      metadata: { reason: "ACTOR_HAS_NO_ACTIVE_LINK", codeConsumed: false },
    });
    res.status(403).json({ state: "not_authorized" });
    return null;
  }

  // -------------------------------------------------------------------------
  // POST /launch/handoffs — landing page, possibly signed out.
  // -------------------------------------------------------------------------
  router.post("/launch/handoffs", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    // Checked BEFORE the body is stored: an unconfigured app URL would strand
    // a sealed code nobody can ever claim.
    if (!deps.appResumeUrl || !deps.config?.baseUrl) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    const parsed = landingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const token = generateHandoffToken();
    const sealed = sealHandoff({
      handoffId: deps.newHandoffId(),
      token,
      launchSessionId: parsed.data.launchSessionId,
      code: parsed.data.code,
      now,
    });
    await deps.handoffs.create(sealed, now);

    await deps.auditSink.record({
      eventType: "stage1.handoff.created",
      occurredAt: now.toISOString(),
      actorId: null, subjectId: null, operatingContext: LAUNCH_OPERATING_CONTEXT,
      authority: { kind: "service_identity" },
      purpose: "property_analysis", scopes: [], outcome: "allowed",
      correlationId: null,
      // Ids only. Never the code, never the token, never the token hash.
      metadata: { handoffId: sealed.handoffId, launchSessionId: sealed.launchSessionId },
    });

    res.status(200).json({
      state: "handoff_created",
      handoffToken: token,
      resumeUrl: deps.appResumeUrl,
      expiresAt: sealed.expiresAt,
    });
  });

  // -------------------------------------------------------------------------
  // POST /launch/handoffs/redeem — the signed-in app.
  // -------------------------------------------------------------------------
  router.post("/launch/handoffs/redeem", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    const session = req.lighthouseSession;
    if (!session) {
      res.status(401).json({ state: "sign_in_required" });
      return;
    }
    const parsed = handoffRedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    // Before claiming: an unlinked actor must not burn the handoff, so they
    // can finish linking and retry within its lifetime.
    const actorLinks = await refuseUnlinkedActor(session.actorRef, res);
    if (!actorLinks) return;

    const now = deps.now();
    const claimed = await deps.handoffs.claim(
      hashHandoffToken(parsed.data.handoffToken), session.actorRef, now,
    );
    const code = claimed ? openHandoff(claimed, parsed.data.handoffToken) : null;
    if (!claimed || code === null) {
      await deps.auditSink.record({
        eventType: "stage1.handoff.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: null, operatingContext: LAUNCH_OPERATING_CONTEXT,
        authority: { kind: "service_identity" },
        purpose: "property_analysis", scopes: [], outcome: "denied",
        correlationId: null,
        metadata: { reason: claimed ? "HANDOFF_UNREADABLE" : "HANDOFF_NOT_CLAIMABLE" },
      });
      // Unknown, expired, already used and tampered are one answer.
      res.status(410).json({ state: "expired" });
      return;
    }

    await completeRedemption(session.actorRef, actorLinks, claimed.launchSessionId, code, res);
  });

  // -------------------------------------------------------------------------
  // POST /launch/redeem — direct, for a caller holding session AND code.
  // -------------------------------------------------------------------------
  router.post("/launch/redeem", async (req: Request, res: Response) => {
    // Fail closed on the flag BEFORE reading the body.
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    // Bootstrap mounts requireSession ahead of this router; checked again here
    // so a mis-mounted router still fails closed.
    const session = req.lighthouseSession;
    if (!session) {
      res.status(401).json({ state: "sign_in_required" });
      return;
    }
    const parsed = landingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // Shape only. The body may contain the one-time code, so nothing from it
      // is echoed back or logged.
      res.status(400).json({ state: "invalid" });
      return;
    }
    const actorLinks = await refuseUnlinkedActor(session.actorRef, res);
    if (!actorLinks) return;
    await completeRedemption(
      session.actorRef, actorLinks, parsed.data.launchSessionId, parsed.data.code, res,
    );
  });

  /** Redeem with Relationship OS, decide ownership, bind. One path for both routes. */
  async function completeRedemption(
    actorRef: string,
    actorLinks: Awaited<ReturnType<LinkRepository["findActiveLinksForActor"]>>,
    launchSessionId: string,
    code: string,
    res: Response,
  ): Promise<void> {
    const outcome = await redeemLaunchSession(
      { launchSessionId, code },
      deps.config,
      deps.redemption,
    );

    const now = deps.now();

    if (outcome.kind === "unconfigured") {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    if (outcome.kind === "ambiguous") {
      await deps.auditSink.record({
        eventType: "stage1.redemption.ambiguous",
        occurredAt: now.toISOString(),
        actorId: actorRef, subjectId: null, operatingContext: LAUNCH_OPERATING_CONTEXT,
        authority: { kind: "service_identity" },
        purpose: "property_analysis", scopes: [], outcome: "error",
        correlationId: outcome.operationId,
        metadata: { reason: outcome.reason },
      });
      // Not retryable in the browser: the code may already be consumed.
      res.status(502).json({ state: "error", operationId: outcome.operationId });
      return;
    }

    if (outcome.kind === "failure") {
      await deps.auditSink.record({
        eventType: "stage1.redemption.denied",
        occurredAt: now.toISOString(),
        actorId: actorRef, subjectId: null, operatingContext: LAUNCH_OPERATING_CONTEXT,
        authority: { kind: "service_identity" },
        purpose: "property_analysis", scopes: [], outcome: "denied",
        correlationId: null,
        metadata: { state: outcome.failure.state, alert: outcome.failure.alert },
      });
      res.status(200).json({
        state: outcome.failure.state,
        message: outcome.failure.message,
        retryable: outcome.failure.retryable,
      });
      return;
    }

    // Redeemed. The signed response is the sole authority on WHAT was
    // launched and BY WHOM; the link store decides whether that person is the
    // one signed in here.
    const context = outcome.context;
    const owner = decideLaunchOwnership(context, actorRef, actorLinks);
    if (!owner.ok) {
      // The code is now consumed. That is the correct trade: a launch that
      // cannot be attributed to its initiator must not produce an analysis
      // for somebody else. Relationship OS can issue a fresh launch.
      await deps.auditSink.record({
        eventType: "stage1.redemption.ownership_denied",
        occurredAt: now.toISOString(),
        actorId: actorRef, subjectId: null, operatingContext: LAUNCH_OPERATING_CONTEXT,
        authority: { kind: "sponsored_entitlement", grantId: context.launchSessionId },
        purpose: "property_analysis", scopes: [], outcome: "denied",
        correlationId: context.correlationId,
        metadata: { reason: owner.reason, schemaVersion: context.schemaVersion, codeConsumed: true },
      });
      res.status(403).json({ state: "not_authorized" });
      return;
    }

    const { binding, rejectedModules } = bindingFromLaunchContext(
      context, deps.newAnalysisId(), now.toISOString(), owner,
    );
    const created = await deps.bindings.createIfAbsent(binding);

    // An idempotent replay may only ever be adopted by the SAME owner.
    if (created.binding.professionalActorRef !== actorRef) {
      await deps.auditSink.record({
        eventType: "stage1.redemption.ownership_denied",
        occurredAt: now.toISOString(),
        actorId: actorRef, subjectId: null, operatingContext: LAUNCH_OPERATING_CONTEXT,
        authority: { kind: "sponsored_entitlement", grantId: context.launchSessionId },
        purpose: "property_analysis", scopes: [], outcome: "denied",
        correlationId: context.correlationId,
        metadata: { reason: "BINDING_OWNED_BY_ANOTHER_ACTOR" },
      });
      res.status(403).json({ state: "not_authorized" });
      return;
    }

    await deps.auditSink.record({
      eventType: "stage1.redemption.succeeded",
      occurredAt: now.toISOString(),
      actorId: actorRef, subjectId: null, operatingContext: LAUNCH_OPERATING_CONTEXT,
      authority: { kind: "sponsored_entitlement", grantId: context.launchSessionId },
      purpose: "property_analysis",
      scopes: context.permittedScopes,
      outcome: "allowed",
      correlationId: context.correlationId,
      metadata: {
        analysisCreated: created.created,
        rejectedModuleCount: rejectedModules.length,
        crossProductLinkId: owner.crossProductLinkId,
      },
    });

    // Only server-selected, allow-listed modules reach the browser. The
    // property projection is returned as-is because it is already the minimum
    // scoped set Relationship OS chose to disclose.
    res.status(200).json({
      state: "success",
      analysisId: created.binding.analysisId,
      analysisType: created.binding.analysisType,
      operatingContext: created.binding.operatingContext,
      modules: created.binding.permittedModules,
      permittedScopes: created.binding.permittedScopes,
      property: context.context.property,
      correlationId: context.correlationId,
    });
  }

  return router;
}
