/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 3 HTTP surface — coarse client-workspace availability disclosure
 * consent.
 *
 * PROVISIONAL, like stage2/linkRoute.ts. Nothing here is reachable until
 * `lighthouse.client_workspace_disclosure` is deliberately enabled, which it
 * is not.
 *
 * BOTH ROUTES ARE SESSION-AUTHENTICATED, AND BOTH ARE CLIENT-SCOPED. This is
 * the client managing their OWN disclosure toward one relationship — never a
 * professional or Relationship OS setting it on the client's behalf. The
 * session's `actorRef` is the only source of the client identity; nothing is
 * ever taken from the request body for that purpose.
 *
 * SETTING CONSENT REQUIRES HOLDING THE LINK. A caller cannot set disclosure
 * consent against a `crossProductLinkId` that is not an active link owned by
 * them — this is checked read-only against `LinkRepository`, which stage 3
 * does not otherwise touch or modify.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import type { LinkRepository } from "../stage2/linkRepository.ts";
import type { WorkspaceDisclosureRepository } from "./workspaceDisclosureRepository.ts";

const FLAG = "lighthouse.client_workspace_disclosure";

const setConsentSchema = z
  .object({
    relationshipRef: z.string().min(1).max(256),
    crossProductLinkId: z.string().min(1).max(256),
    consented: z.boolean(),
  })
  .strict();

export interface WorkspaceDisclosureRouteDependencies {
  readonly links: LinkRepository;
  readonly disclosures: WorkspaceDisclosureRepository;
  readonly auditSink: AuditSink;
  readonly now: () => Date;
  readonly env?: Record<string, string | undefined>;
}

/** Single opaque denial, mirroring stage2/linkRoute.ts's `deny()`. */
function deny(res: Response, status: number): void {
  res.status(status).json({ state: "denied" });
}

const LINK_ACTIVE_STATES = new Set(["pending", "active", "suspended"]);

export function createWorkspaceDisclosureRouter(
  deps: WorkspaceDisclosureRouteDependencies,
): Router {
  const router = Router();

  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  // -------------------------------------------------------------------------
  // POST /workspace-disclosure — set/revoke consent for a relationship.
  // -------------------------------------------------------------------------
  router.post("/workspace-disclosure", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    const parsed = setConsentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const correlationId = randomUUID();
    const { relationshipRef, crossProductLinkId, consented } = parsed.data;

    // The caller must actually hold this link, and it must name the same
    // relationship they are asking to disclose to. Both checks read-only —
    // this router never mutates a link.
    const link = await deps.links.findLinkById(crossProductLinkId);
    const ownsLink =
      link !== null &&
      link.investscapeUserRef === session.actorRef &&
      link.relationshipRef === relationshipRef &&
      LINK_ACTIVE_STATES.has(link.lifecycle.state);

    if (!ownsLink) {
      await deps.auditSink.record({
        eventType: "stage3.disclosure.set",
        occurredAt: now.toISOString(),
        actorId: session.actorRef,
        subjectId: null,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "workspace_disclosure",
        scopes: ["workspace.availability.read"],
        outcome: "denied",
        correlationId,
        metadata: { reason: "link_not_owned" },
      });
      deny(res, 403);
      return;
    }

    const consent = await deps.disclosures.setConsent(
      session.actorRef,
      relationshipRef,
      crossProductLinkId,
      consented,
      now,
    );

    await deps.auditSink.record({
      eventType: "stage3.disclosure.set",
      occurredAt: now.toISOString(),
      actorId: session.actorRef,
      subjectId: null,
      operatingContext: "personal",
      authority: { kind: "self" },
      purpose: "workspace_disclosure",
      scopes: ["workspace.availability.read"],
      outcome: "allowed",
      correlationId,
      metadata: { relationshipRef, consented },
    });

    res.status(200).json({
      state: "ok",
      relationshipRef: consent.relationshipRef,
      consented: consent.consented,
      consentedAt: consent.consentedAt,
      revokedAt: consent.revokedAt,
      version: consent.version,
    });
  });

  // -------------------------------------------------------------------------
  // GET /workspace-disclosure/:relationshipRef — the caller's OWN consent.
  // -------------------------------------------------------------------------
  router.get(
    "/workspace-disclosure/:relationshipRef",
    async (req: Request, res: Response) => {
      if (!enabled()) {
        res.status(503).json({ state: "unavailable" });
        return;
      }

      const session = req.lighthouseSession;
      if (!session) {
        deny(res, 401);
        return;
      }

      const rawRelationshipRef = req.params.relationshipRef;
      const relationshipRef =
        typeof rawRelationshipRef === "string" ? rawRelationshipRef : "";
      if (relationshipRef.length === 0) {
        res.status(400).json({ state: "invalid" });
        return;
      }

      // Scoped by the session's actor ref inside the query — no parameter can
      // widen this to another client's consent.
      const consent = await deps.disclosures.getConsent(session.actorRef, relationshipRef);

      res.status(200).json({
        state: "ok",
        relationshipRef,
        consented: consent?.consented ?? false,
        consentedAt: consent?.consentedAt ?? null,
        revokedAt: consent?.revokedAt ?? null,
        version: consent?.version ?? 0,
      });
    },
  );

  return router;
}
