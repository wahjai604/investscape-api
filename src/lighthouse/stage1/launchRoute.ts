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
  type RedemptionConfig, type RedemptionDependencies, redeemLaunchSession,
} from "./redemptionClient.ts";

/**
 * The browser sends ONLY these two values. Note what is absent: modules,
 * scopes, propertyId, tier, relationship. Anything else in the body is ignored
 * — authority comes from the redemption response, never from the client.
 */
const landingRequestSchema = z
  .object({
    launchSessionId: z.string().min(1).max(128),
    code: z.string().min(1).max(512),
  })
  .strict();

export interface LaunchRouteDependencies {
  readonly config: Partial<RedemptionConfig> | null;
  readonly redemption: RedemptionDependencies;
  readonly bindings: AnalysisBindingRepository;
  /** The Stage 2 link store: the only evidence that RoS person == IS actor. */
  readonly links: Pick<LinkRepository, "findActiveLinksForActor">;
  readonly auditSink: AuditSink;
  readonly newAnalysisId: () => string;
  readonly now: () => Date;
  readonly env?: Record<string, string | undefined>;
}

const FLAG = "lighthouse.stage1_launch_receiver";

export function createLaunchRouter(deps: LaunchRouteDependencies): Router {
  const router = Router();

  router.post("/launch/redeem", async (req: Request, res: Response) => {
    // Fail closed on the flag BEFORE reading the body.
    if (!isFeatureEnabled(FLAG, deps.env ?? process.env)) {
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
    const actorRef = session.actorRef;

    const parsed = landingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // Shape only. The body may contain the one-time code, so nothing from it
      // is echoed back or logged.
      res.status(400).json({ state: "invalid" });
      return;
    }

    // Pre-redemption gate: an actor with no active cross-product link cannot
    // be the initiator, so refuse WITHOUT consuming the one-time code.
    const actorLinks = await deps.links.findActiveLinksForActor(actorRef);
    if (!actorCanBeLaunchInitiator(actorLinks)) {
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
      return;
    }

    const outcome = await redeemLaunchSession(
      { launchSessionId: parsed.data.launchSessionId, code: parsed.data.code },
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
  });

  return router;
}
