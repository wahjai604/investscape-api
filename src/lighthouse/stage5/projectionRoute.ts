/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 5 HTTP surface — professional connectivity projection.
 *
 * PROVISIONAL, like stage2/linkRoute.ts. Nothing here is reachable until
 * `lighthouse.professional_connectivity_projection` is deliberately enabled,
 * which it is not.
 *
 * SERVICE-AUTHENTICATED, NOT SESSION-AUTHENTICATED — a deliberate choice,
 * mirroring `POST /link/invitations`. The caller of this route is
 * Relationship OS asking, on behalf of a professional it has already
 * authenticated, "what may this professional be shown about their connected
 * client." InvestScape never authenticates the professional directly here;
 * it authenticates the SERVICE via HMAC (same as invitation creation), and
 * trusts Relationship OS's own authorization of which professional/
 * relationship pair is asking. Judgment call: if a future requirement needs
 * InvestScape to independently verify the professional's own session, this
 * route should be revisited — but nothing in the Stage 5 domain layer or the
 * task materials suggested an InvestScape-side professional session exists
 * for this call.
 *
 * WHAT THIS ROUTE WILL NEVER GROW: an endpoint that lists a client's
 * analyses. `enumerateClientAnalyses()` in domain/connectionProjection.ts
 * exists specifically to make that a loud thrown error — this file must
 * never call it or route around it.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import type { NonceStore } from "../service-auth/nonceStore.ts";
import { verifyRequest } from "../service-auth/hmac.ts";
import { buildProfessionalProjection, type ProjectionInput } from "../domain/connectionProjection.ts";
import type { LinkRepository } from "../stage2/linkRepository.ts";
import type { WorkspaceDisclosureRepository } from "../stage3/workspaceDisclosureRepository.ts";

const FLAG = "lighthouse.professional_connectivity_projection";

const projectionRequestSchema = z
  .object({
    relationshipRef: z.string().min(1).max(256),
    crossProductLinkId: z.string().min(1).max(256),
    /** The InvestScape client actor this link belongs to. */
    clientActorRef: z.string().min(1).max(256),
  })
  .strict();

export interface ConnectionProjectionSource {
  /** Live workspace availability, when disclosure has been consented. Never read otherwise. */
  isWorkspaceAvailable(clientActorRef: string): Promise<boolean>;
  /** Count of ACTIVE grants to this relationship only (Stage 4). */
  countActiveSharedResults(relationshipRef: string, clientActorRef: string): Promise<number>;
}

export interface ProjectionRouteDependencies {
  readonly links: LinkRepository;
  readonly disclosures: WorkspaceDisclosureRepository;
  readonly source: ConnectionProjectionSource;
  readonly auditSink: AuditSink;
  readonly nonces: NonceStore;
  /** keyId -> secret for INBOUND verification. Empty disables this router. */
  readonly inboundSecrets: Readonly<Record<string, string>>;
  readonly now: () => Date;
  readonly env?: Record<string, string | undefined>;
}

function deny(res: Response, status: number): void {
  res.status(status).json({ state: "denied" });
}

function toLinkState(
  state: "pending" | "active" | "suspended" | "revoked" | "expired" | undefined,
): ProjectionInput["linkState"] {
  return state ?? "none";
}

export function createProjectionRouter(deps: ProjectionRouteDependencies): Router {
  const router = Router();

  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  router.post("/connection-projection", async (req: Request, res: Response) => {
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
        eventType: "stage5.projection.signature_rejected",
        occurredAt: deps.now().toISOString(),
        actorId: null,
        subjectId: null,
        operatingContext: "professional_assisted",
        authority: { kind: "service_identity" },
        purpose: "connection_projection",
        scopes: [],
        outcome: "denied",
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

    const parsed = projectionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const correlationId = randomUUID();
    const { relationshipRef, crossProductLinkId, clientActorRef } = parsed.data;

    // Read-only lookups. The link must actually belong to this client and
    // relationship pair, or the projection is built as "not connected" rather
    // than trusting the caller's assertion.
    const link = await deps.links.findLinkById(crossProductLinkId);
    const linkMatches =
      link !== null &&
      link.investscapeUserRef === clientActorRef &&
      link.relationshipRef === relationshipRef;

    const linkState = linkMatches ? toLinkState(link!.lifecycle.state) : "none";

    const consent = linkMatches
      ? await deps.disclosures.getConsent(clientActorRef, relationshipRef)
      : null;
    const workspaceDisclosureConsented = consent?.consented === true;

    const workspaceIsAvailable = workspaceDisclosureConsented
      ? await deps.source.isWorkspaceAvailable(clientActorRef)
      : undefined;

    const sharedResultCount = linkMatches
      ? await deps.source.countActiveSharedResults(relationshipRef, clientActorRef)
      : 0;

    const projectionInput: ProjectionInput = {
      linkState,
      workspaceDisclosureConsented,
      ...(workspaceIsAvailable !== undefined ? { workspaceIsAvailable } : {}),
      sharedResultCount,
      isProjectionEnabled: true,
    };

    const projection = buildProfessionalProjection(projectionInput);

    await deps.auditSink.record({
      eventType: "stage5.projection.served",
      occurredAt: now.toISOString(),
      actorId: null,
      subjectId: clientActorRef,
      operatingContext: "professional_assisted",
      authority: { kind: "service_identity" },
      purpose: "connection_projection",
      scopes: ["workspace.availability.read"],
      outcome: "allowed",
      correlationId,
      metadata: {
        relationshipRef,
        connectionState: projection.connectionState,
      },
    });

    res.status(200).json({
      state: "ok",
      connectionState: projection.connectionState,
      workspaceAvailability: projection.workspaceAvailability,
      statusLabel: projection.statusLabel,
      sharedResultCount: projection.sharedResultCount,
    });
  });

  return router;
}
