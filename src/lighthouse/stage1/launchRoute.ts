/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * ============================================================================
 * NOT MOUNTED. This router is deliberately NOT registered in src/index.ts.
 * ============================================================================
 * The Stages 2-8 foundation brief says: "Do not create production data, enable
 * routes, configure real URLs/secrets, or expose unfinished controls."
 *
 * So this exists to be REVIEWED, not served. Mounting it is a separate, explicit
 * decision that should happen only after:
 *   1. a database and secret manager exist in this service;
 *   2. Relationship OS confirms the launch-context response shape;
 *   3. the header-name discrepancy (x-lighthouse-* vs X-Service-*) is resolved;
 *   4. LIGHTHOUSE_FF_STAGE1_LAUNCH_RECEIVER is deliberately enabled.
 *
 * Even then it fails closed: with the flag off every request gets 503.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import type { AnalysisBindingRepository } from "./analysisBinding.ts";
import { bindingFromLaunchContext } from "./analysisBinding.ts";
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

    const parsed = landingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // Shape only. The body may contain the one-time code, so nothing from it
      // is echoed back or logged.
      res.status(400).json({ state: "invalid" });
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
        actorId: null, subjectId: null, operatingContext: "professional_assisted",
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
        actorId: null, subjectId: null, operatingContext: "professional_assisted",
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

    // Success. The redemption response is the sole authority.
    const context = outcome.context;
    const { binding, rejectedModules } = bindingFromLaunchContext(
      context, deps.newAnalysisId(), now.toISOString(),
    );
    const created = await deps.bindings.createIfAbsent(binding);

    await deps.auditSink.record({
      eventType: "stage1.redemption.succeeded",
      occurredAt: now.toISOString(),
      actorId: null, subjectId: null, operatingContext: "professional_assisted",
      authority: { kind: "sponsored_entitlement", grantId: context.launchSessionId },
      purpose: "property_analysis",
      scopes: context.permittedScopes,
      outcome: "allowed",
      correlationId: context.correlationId,
      metadata: {
        analysisCreated: created.created,
        rejectedModuleCount: rejectedModules.length,
      },
    });

    // Only server-selected, allow-listed modules reach the browser. The
    // property projection is returned as-is because it is already the minimum
    // scoped set Relationship OS chose to disclose.
    res.status(200).json({
      state: "success",
      analysisId: created.binding.analysisId,
      analysisType: created.binding.analysisType,
      modules: created.binding.permittedModules,
      permittedScopes: created.binding.permittedScopes,
      property: context.context.property,
      correlationId: context.correlationId,
    });
  });

  return router;
}
