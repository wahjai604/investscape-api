/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 HTTP surface — inbound lifecycle event sync, contract v0.3 r3 §3.
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
 *   6. rule 1: strict schema, JCS digest recomputed and compared -> 400,
 *      NO ledger row
 *   7. rules 2–11 in ONE transaction (stage6/eventIntegrity.ts)
 *   8. after commit only: audit, quarantine alert hook, invalidation hook
 *
 * Responses are `lighthouse.event-ack.v1`: 200 for applied / applied_with_gap
 * / duplicate / stale / superseded, 409 for conflict and blocked, 422 for
 * rejected_transition. Relationship OS is asking about the fate of its OWN
 * event, not probing state it has no business seeing.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import type { NonceStore } from "../service-auth/nonceStore.ts";
import { verifyRequest } from "../service-auth/hmac.ts";
import { JcsError } from "./jcs.ts";
import {
  computeEventDigest,
  computeVersionContentDigest,
  type EventEnvelope,
} from "./eventDigest.ts";
import {
  processInboundEvent,
  type EventIntegrityStore,
  type QuarantineAlert,
} from "./eventIntegrity.ts";
import { AGGREGATE_KINDS, definitionFor, isKnownAggregateKind, type AggregateKind } from "./lifecycleDispatcher.ts";

const FLAG = "lighthouse.lifecycle_synchronization";

const eventSchema = z
  .object({
    eventId: z.string().min(1).max(128),
    schemaVersion: z.string().min(1).max(128),
    aggregateKind: z.enum(AGGREGATE_KINDS),
    aggregateId: z.string().min(1).max(256),
    targetState: z.string().min(1).max(64),
    version: z.number().int().min(1).max(2_147_483_647),
    // int64 as a decimal string, no sign and no leading zeros.
    changeSeq: z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
    // Informational; digested byte-for-byte, never used for ordering. It must
    // still be a real instant because it is stored as a timestamp.
    occurredAt: z.string().min(1).max(64).refine((v) => !Number.isNaN(Date.parse(v))),
    correlationId: z.string().min(1).max(256).optional(),
    eventDigest: z.string().regex(/^[0-9a-f]{64}$/),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

/**
 * Called once per quarantine a committed event opened or joined. Routing,
 * severity and retention are DECISION REQUIRED (contract D8) — this hook is
 * the integration point only; it must not throw into the request.
 */
export type QuarantineAlertHook = (alert: QuarantineAlert) => Promise<void> | void;

export interface InboundEventRouteDependencies {
  readonly eventIntegrity: EventIntegrityStore;
  readonly auditSink: AuditSink;
  readonly nonces: NonceStore;
  /** keyId -> secret for INBOUND verification. Empty disables this route. */
  readonly inboundSecrets: Readonly<Record<string, string>>;
  readonly now: () => Date;
  readonly newQuarantineId: () => string;
  readonly onQuarantineAlert?: QuarantineAlertHook;
  /**
   * Fired after commit when an applied event moved the aggregate into a
   * revoking state. This codebase has no cache layer to invalidate yet.
   */
  readonly onInvalidate?: (aggregateKind: AggregateKind, aggregateId: string) => Promise<void> | void;
  readonly env?: Record<string, string | undefined>;
}

function deny(res: Response, status: number): void {
  res.status(status).json({ state: "denied" });
}

export function createInboundEventRouter(deps: InboundEventRouteDependencies): Router {
  const router = Router();
  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  const audit = async (
    eventType: string,
    outcome: "allowed" | "denied",
    subjectId: string | null,
    correlationId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> => {
    await deps.auditSink.record({
      eventType,
      occurredAt: deps.now().toISOString(),
      actorId: null, subjectId, operatingContext: "professional_assisted",
      authority: { kind: "service_identity" },
      purpose: "lifecycle_synchronization", scopes: [], outcome,
      correlationId,
      metadata,
    });
  };

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
      await audit("stage6.event.signature_rejected", "denied", null, null, { reason: verified.reason });
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

    // Rule 1. Nothing is ledgered for a malformed event: the sender must fix
    // it and send a NEW eventId.
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid", outcome: "rejected_malformed" });
      return;
    }
    const { eventDigest: sentDigest, ...fields } = parsed.data;
    const envelope: EventEnvelope = fields;

    let eventDigest: string;
    let versionContentDigest: string;
    try {
      eventDigest = computeEventDigest(envelope);
      versionContentDigest = computeVersionContentDigest(envelope);
    } catch (error) {
      if (!(error instanceof JcsError)) throw error;
      res.status(400).json({ state: "invalid", outcome: "rejected_malformed" });
      return;
    }
    if (eventDigest !== sentDigest) {
      await audit("stage6.event.digest_mismatch", "denied", envelope.aggregateId, envelope.correlationId ?? null, {
        eventId: envelope.eventId, aggregateKind: envelope.aggregateKind,
      });
      res.status(400).json({ state: "invalid", outcome: "rejected_malformed", reason: "EVENT_DIGEST_MISMATCH" });
      return;
    }

    const result = await processInboundEvent(
      { envelope, eventDigest, versionContentDigest },
      {
        store: deps.eventIntegrity,
        definitionFor: (kind) => (isKnownAggregateKind(kind) ? definitionFor(kind) : null),
        now: deps.now,
        newQuarantineId: deps.newQuarantineId,
      },
    );

    if (result.kind === "store_not_configured") {
      // This deployment has not wired a table for this aggregate kind (e.g.
      // "entitlement", which has no persistence anywhere). Expected, not an
      // integration fault; nothing was recorded.
      res.status(503).json({ state: "unavailable" });
      return;
    }
    if (result.kind === "aggregate_not_found") {
      // The store IS wired, but InvestScape never created this aggregate: the
      // two products' views have diverged. Nothing was recorded, so a later
      // retry is evaluated afresh. 409 rather than 503 — a 503 invites an
      // indefinite retry loop that cannot succeed on its own.
      await audit("stage6.event.aggregate_not_found", "denied", envelope.aggregateId, envelope.correlationId ?? null, {
        eventId: envelope.eventId, aggregateKind: envelope.aggregateKind,
      });
      res.status(409).json({ state: "conflict", reason: "AGGREGATE_NOT_FOUND" });
      return;
    }

    // Committed. Everything below is a consequence, never a precondition.
    const { ack } = result;
    await audit(
      `stage6.event.${ack.outcome}`,
      result.httpStatus === 200 ? "allowed" : "denied",
      ack.aggregateId,
      envelope.correlationId ?? null,
      {
        eventId: ack.eventId,
        aggregateKind: ack.aggregateKind,
        version: ack.version,
        outcome: ack.outcome,
        replayed: result.replayed,
        ...(ack.originalOutcome ? { originalOutcome: ack.originalOutcome } : {}),
        ...(ack.conflictKind ? { conflictKind: ack.conflictKind } : {}),
        ...(ack.quarantineId ? { quarantineId: ack.quarantineId } : {}),
      },
    );

    if (result.quarantineAlert) {
      const alert = result.quarantineAlert;
      await audit(
        alert.opened ? "stage6.quarantine.opened" : "stage6.quarantine.joined",
        "denied",
        alert.aggregateId,
        envelope.correlationId ?? null,
        {
          quarantineId: alert.quarantineId, aggregateKind: alert.aggregateKind,
          version: alert.version, kind: alert.kind, eventId: alert.eventId,
        },
      );
      if (deps.onQuarantineAlert) {
        try {
          await deps.onQuarantineAlert(alert);
        } catch {
          // An alerting failure must not turn a committed, correct answer
          // into an error the sender would retry. The audit row above stands.
        }
      }
    }

    if (result.applied && result.invalidatesAccess && deps.onInvalidate) {
      await deps.onInvalidate(envelope.aggregateKind as AggregateKind, envelope.aggregateId);
    }

    res.status(result.httpStatus).json(ack);
  });

  return router;
}
