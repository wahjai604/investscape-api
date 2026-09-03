/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 HTTP surface — inbound lifecycle event sync.
 *
 * PROVISIONAL, like every cross-product surface here. Nothing is reachable
 * until `lighthouse.lifecycle_synchronization` is deliberately enabled, which
 * it is not.
 *
 *   POST /sync/events   service-authenticated (HMAC from Relationship OS)
 *
 * ORDER OF CHECKS (load-bearing, mirrors stage2/linkRoute.ts):
 *   1. feature flag                     -> 503
 *   2. inbound secrets configured       -> 503
 *   3. raw body captured                -> 503
 *   4. HMAC signature                   -> 401
 *   5. nonce replay                     -> 401
 *   6. schema (.strict(), payloadHash REQUIRED) -> 400
 *   7. idempotency ledger pre-check (event_id -> payload_hash)
 *   8. dispatch through the domain lifecycle engine
 *   9. record the ledger row
 *
 * The payload-hash conflict check (step 7) is the single most important
 * property here: a reused event_id with DIFFERENT bytes must be reported as
 * "conflict", never silently absorbed as "duplicate" — the 2026-09-02 P0 fix
 * this endpoint exists to actually use.
 *
 * This endpoint MAY tell the caller what happened (applied/duplicate/conflict/
 * stale/rejected) — Relationship OS is asking about the fate of its OWN event,
 * not probing state it has no business seeing.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import type { NonceStore } from "../service-auth/nonceStore.ts";
import { verifyRequest } from "../service-auth/hmac.ts";
import type { InboundEventOutcome, InboundEventRepository } from "./inboundEventRepository.ts";
import {
  AGGREGATE_KINDS,
  dispatchLifecycleEvent,
  type DispatchDependencies,
} from "./lifecycleDispatcher.ts";

const FLAG = "lighthouse.lifecycle_synchronization";

const eventSchema = z
  .object({
    eventId: z.string().min(1).max(128),
    schemaVersion: z.string().min(1).max(32).default("1"),
    aggregateKind: z.enum(AGGREGATE_KINDS),
    aggregateId: z.string().min(1).max(256),
    targetState: z.string().min(1).max(64),
    version: z.number().int().min(0),
    occurredAt: z.string().min(1).max(64),
    correlationId: z.string().min(1).max(256).optional(),
    // REQUIRED. See module doc — this is the P0 fix's enforcement point.
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export interface InboundEventRouteDependencies {
  readonly inboundEvents: InboundEventRepository;
  readonly dispatch: DispatchDependencies;
  readonly auditSink: AuditSink;
  readonly nonces: NonceStore;
  /** keyId -> secret for INBOUND verification. Empty disables this route. */
  readonly inboundSecrets: Readonly<Record<string, string>>;
  readonly now: () => Date;
  readonly env?: Record<string, string | undefined>;
}

function deny(res: Response, status: number): void {
  res.status(status).json({ state: "denied" });
}

export function createInboundEventRouter(deps: InboundEventRouteDependencies): Router {
  const router = Router();
  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  router.post("/sync/events", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    if (Object.keys(deps.inboundSecrets).length === 0) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (typeof rawBody !== "string") {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    const verified = verifyRequest({
      headers: req.headers,
      method: req.method,
      path: req.originalUrl.split("?")[0] ?? req.path,
      rawBody,
      expectedService: "relationship-os",
      secrets: deps.inboundSecrets,
      now: () => Math.floor(deps.now().getTime() / 1000),
    });

    if (!verified.ok) {
      await deps.auditSink.record({
        eventType: "stage6.event.signature_rejected",
        occurredAt: deps.now().toISOString(),
        actorId: null, subjectId: null, operatingContext: "professional_assisted",
        authority: { kind: "service_identity" },
        purpose: "lifecycle_synchronization", scopes: [], outcome: "denied",
        correlationId: null,
        metadata: { reason: verified.reason },
      });
      deny(res, 401);
      return;
    }

    const fresh = await deps.nonces.consume(
      "relationship-os",
      verified.keyId,
      verified.nonce,
      verified.timestamp,
    );
    if (!fresh) {
      deny(res, 401);
      return;
    }

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const {
      eventId, schemaVersion, aggregateKind, aggregateId,
      targetState, version, occurredAt, correlationId, payloadHash,
    } = parsed.data;

    // Idempotency pre-check, BEFORE any attempt to apply. A previously-seen
    // event id is answered from the ledger, never re-dispatched.
    const existing = await deps.inboundEvents.findByEventId(eventId);
    if (existing) {
      const outcome: InboundEventOutcome =
        existing.payloadHash === payloadHash ? "duplicate" : "conflict";

      await deps.auditSink.record({
        eventType: `stage6.event.${outcome}`,
        occurredAt: now.toISOString(),
        actorId: null, subjectId: aggregateId, operatingContext: "professional_assisted",
        authority: { kind: "service_identity" },
        purpose: "lifecycle_synchronization", scopes: [], outcome: "allowed",
        correlationId: correlationId ?? null,
        metadata: { eventId, aggregateKind, outcome },
      });

      res.status(200).json({
        state: "ok",
        outcome,
        aggregateKind,
        aggregateId,
      });
      return;
    }

    const result = await dispatchLifecycleEvent(
      aggregateKind,
      aggregateId,
      { eventId, targetState, version, occurredAt, correlationId, payloadHash },
      deps.dispatch,
    );

    if (!result.ok) {
      // Unknown aggregate kind cannot happen — the schema's z.enum already
      // rejects it with a 400.
      if (result.reason === "STORE_NOT_CONFIGURED") {
        // This deployment has not wired an adapter for this aggregate kind
        // yet (e.g. "entitlement", which has no persistence layer anywhere
        // in this codebase). Expected, not an integration fault, and not
        // worth an audit row every time it fires.
        res.status(503).json({ state: "unavailable" });
        return;
      }
      // AGGREGATE_NOT_FOUND: the store IS wired, but this specific aggregate
      // has no local row at all — Relationship OS believes an aggregate
      // exists that InvestScape has never locally created (e.g. a link
      // event arriving before that link's own accept flow ran here). This is
      // a genuine divergence between the two products' views, not a
      // transient/config problem, so it is audited (unlike the case above)
      // and returned as 409 rather than 503 — a 503 invites an indefinite
      // retry loop that can never succeed on its own.
      await deps.auditSink.record({
        eventType: "stage6.event.aggregate_not_found",
        occurredAt: now.toISOString(),
        actorId: null, subjectId: aggregateId, operatingContext: "professional_assisted",
        authority: { kind: "service_identity" },
        purpose: "lifecycle_synchronization", scopes: [], outcome: "denied",
        correlationId: correlationId ?? null,
        metadata: { eventId, aggregateKind },
      });
      res.status(409).json({ state: "conflict", reason: "AGGREGATE_NOT_FOUND" });
      return;
    }

    await deps.inboundEvents.recordOutcome(
      {
        eventId, schemaVersion, aggregateId, aggregateKind,
        version, payloadHash, outcome: result.outcome.kind,
        occurredAt, correlationId: correlationId ?? null,
      },
      now,
    );

    await deps.auditSink.record({
      eventType: `stage6.event.${result.outcome.kind}`,
      occurredAt: now.toISOString(),
      actorId: null, subjectId: aggregateId, operatingContext: "professional_assisted",
      authority: { kind: "service_identity" },
      purpose: "lifecycle_synchronization", scopes: [], outcome: "allowed",
      correlationId: correlationId ?? null,
      metadata: {
        eventId, aggregateKind,
        outcome: result.outcome.kind,
        reason: "reason" in result.outcome ? result.outcome.reason : undefined,
      },
    });

    res.status(200).json({
      state: "ok",
      outcome: result.outcome.kind,
      aggregateKind,
      aggregateId,
    });
  });

  return router;
}
