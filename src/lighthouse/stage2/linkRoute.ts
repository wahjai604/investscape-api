/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 2 HTTP surface — cross-product identity linking.
 *
 * PROVISIONAL. These request/response shapes have NOT been agreed with the
 * Relationship OS side. Treat them as a proposal to review, not a contract to
 * build against. Nothing here is reachable until
 * LIGHTHOUSE_FF_CROSS_PRODUCT_IDENTITY_LINKING is deliberately enabled, which
 * it is not.
 *
 * TWO DIFFERENT AUTHORITIES, DELIBERATELY NOT INTERCHANGEABLE
 *
 *   POST /link/invitations   service-authenticated (HMAC from Relationship OS)
 *   POST /link/accept        session-authenticated (an InvestScape user)
 *   GET  /link/status        session-authenticated
 *   POST /link/:id/unlink    session-authenticated
 *
 * This split IS the dual-authentication proof. Relationship OS asserts "I
 * authenticated this person" by signing the invitation-creation request with a
 * key only it holds; InvestScape asserts "I authenticated this user" via the
 * verified session on the accept request. Neither side can produce both halves
 * alone. If invitation creation ever becomes reachable with a session instead
 * of a service signature, the proof collapses and a user could link themselves
 * to an arbitrary Relationship OS person — so that route's auth is load-bearing,
 * not ceremonial.
 *
 * WHAT A CONFIRMED LINK GRANTS: nothing. Not analysis access, not sharing, not
 * delegation, not subscription. See LINK_GRANTS in domain/crossProductLink.ts,
 * which is empty and has a test pinning it empty.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import type { NonceStore } from "../service-auth/nonceStore.ts";
import { verifyRequest } from "../service-auth/hmac.ts";
import {
  DEFAULT_INVITATION_TTL_SECONDS,
  MAX_INVITATION_TTL_SECONDS,
  MIN_INVITATION_TTL_SECONDS,
  generateChallenge,
  hashChallenge,
} from "../domain/crossProductLink.ts";
import type { LinkRepository } from "./linkRepository.ts";

const FLAG = "lighthouse.cross_product_identity_linking";

/**
 * Invitation creation. Note what is absent: no email, no name, no phone. The
 * `.strict()` means an unexpected field is a 400 rather than being silently
 * ignored — if Relationship OS ever starts sending an email we find out loudly.
 */
const createInvitationSchema = z
  .object({
    relationshipOsPersonRef: z.string().min(1).max(256),
    relationshipRef: z.string().min(1).max(256),
    noticeVersion: z.string().min(1).max(64),
    ttlSeconds: z
      .number()
      .int()
      .min(MIN_INVITATION_TTL_SECONDS)
      .max(MAX_INVITATION_TTL_SECONDS)
      .optional(),
  })
  .strict();

const acceptSchema = z
  .object({
    invitationId: z.string().min(1).max(128),
    challenge: z.string().min(1).max(512),
  })
  .strict();

const unlinkSchema = z
  .object({
    // Compare-and-set. Prevents a stale client revoking a link that changed.
    expectedVersion: z.number().int().min(0),
  })
  .strict();

export interface LinkRouteDependencies {
  readonly links: LinkRepository;
  readonly auditSink: AuditSink;
  readonly nonces: NonceStore;
  /** keyId -> secret for INBOUND verification. Empty disables service routes. */
  readonly inboundSecrets: Readonly<Record<string, string>>;
  readonly now: () => Date;
  readonly newInvitationId: () => string;
  readonly env?: Record<string, string | undefined>;
}

/** Single opaque denial. Reasons are audited server-side, never returned. */
function deny(res: Response, status: number): void {
  res.status(status).json({ state: "denied" });
}

export function createLinkRouter(deps: LinkRouteDependencies): Router {
  const router = Router();

  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  // -------------------------------------------------------------------------
  // POST /link/invitations — Relationship OS asks us to mint a challenge.
  // -------------------------------------------------------------------------
  router.post("/link/invitations", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    // No configured inbound key means we cannot authenticate the caller. Refuse
    // rather than accept unauthenticated invitation creation.
    if (Object.keys(deps.inboundSecrets).length === 0) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (typeof rawBody !== "string") {
      // Raw bytes were not retained, so the signature cannot be checked over
      // what was actually received. Never fall back to re-serialising the
      // parsed body — that silently changes what is being verified.
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
      // Use the injected clock rather than letting the verifier reach for
      // Date.now(). Two reasons: the skew window is then testable, and the
      // whole request is evaluated against one consistent instant.
      now: () => Math.floor(deps.now().getTime() / 1000),
    });

    if (!verified.ok) {
      await deps.auditSink.record({
        eventType: "stage2.invitation.signature_rejected",
        occurredAt: deps.now().toISOString(),
        actorId: null, subjectId: null, operatingContext: "professional_assisted",
        authority: { kind: "service_identity" },
        purpose: "identity_linking", scopes: [], outcome: "denied",
        correlationId: null,
        metadata: { reason: verified.reason },
      });
      deny(res, 401);
      return;
    }

    // A valid signature is not enough — a captured request could be replayed.
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

    const parsed = createInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const ttl = parsed.data.ttlSeconds ?? DEFAULT_INVITATION_TTL_SECONDS;
    const challenge = generateChallenge();
    const invitationId = deps.newInvitationId();
    const correlationId = randomUUID();

    await deps.links.createInvitation({
      invitationId,
      // Only the hash is persisted. The plaintext below is returned once and
      // then exists nowhere on this side.
      challengeHash: hashChallenge(challenge),
      relationshipOsPersonRef: parsed.data.relationshipOsPersonRef,
      relationshipRef: parsed.data.relationshipRef,
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      noticeVersion: parsed.data.noticeVersion,
      correlationId,
      consumedAt: null,
    });

    await deps.auditSink.record({
      eventType: "stage2.invitation.created",
      occurredAt: now.toISOString(),
      actorId: null,
      subjectId: parsed.data.relationshipOsPersonRef,
      operatingContext: "professional_assisted",
      authority: { kind: "service_identity" },
      purpose: "identity_linking", scopes: [], outcome: "allowed",
      correlationId,
      // The challenge is deliberately not in the audit metadata.
      metadata: { invitationId, ttlSeconds: ttl },
    });

    res.status(201).json({
      state: "created",
      invitationId,
      challenge,
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      correlationId,
    });
  });

  // -------------------------------------------------------------------------
  // POST /link/accept — an authenticated InvestScape user presents a challenge.
  // -------------------------------------------------------------------------
  router.post("/link/accept", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    // requireSession runs ahead of this router; this is defence in depth, not
    // the primary check. If it ever fires, the mounting is wrong.
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

    const outcome = await deps.links.accept({
      invitationId: parsed.data.invitationId,
      presentedChallenge: parsed.data.challenge,
      // From the verified token. Never from the body.
      investscapeActorRef: session.actorRef,
      correlationId,
      now,
      isEnabled: true,
    });

    if (!outcome.ok) {
      await deps.auditSink.record({
        eventType: "stage2.link.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: null,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "identity_linking", scopes: [], outcome: "denied",
        correlationId,
        metadata: { reason: outcome.reason },
      });
      // One shape for every denial. Telling a caller "expired" vs "already
      // consumed" vs "wrong challenge" is a free oracle for probing invitations.
      deny(res, 403);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage2.link.accepted",
      occurredAt: now.toISOString(),
      actorId: session.actorRef,
      subjectId: outcome.link.relationshipOsPersonRef,
      operatingContext: "personal",
      authority: { kind: "self" },
      purpose: "identity_linking", scopes: [], outcome: "allowed",
      correlationId,
      metadata: {
        crossProductLinkId: outcome.link.crossProductLinkId,
        created: outcome.created,
      },
    });

    res.status(outcome.created ? 201 : 200).json({
      state: "linked",
      crossProductLinkId: outcome.link.crossProductLinkId,
      relationshipRef: outcome.link.relationshipRef,
      acceptedAt: outcome.link.acceptedAt,
      version: outcome.link.lifecycle.version,
      // Stated in the response, not just the docs, so a client cannot infer
      // capabilities from the mere existence of a link.
      grants: [],
    });
  });

  // -------------------------------------------------------------------------
  // GET /link/status — the caller's OWN links. Never anybody else's.
  // -------------------------------------------------------------------------
  router.get("/link/status", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    // Scoped by the session's actor ref inside the query. There is no parameter
    // a caller could supply to widen this.
    const links = await deps.links.findActiveLinksForActor(session.actorRef);

    res.status(200).json({
      state: "ok",
      links: links.map((link) => ({
        crossProductLinkId: link.crossProductLinkId,
        relationshipRef: link.relationshipRef,
        state: link.lifecycle.state,
        version: link.lifecycle.version,
        acceptedAt: link.acceptedAt,
        noticeVersion: link.noticeVersion,
      })),
      grants: [],
    });
  });

  // -------------------------------------------------------------------------
  // POST /link/:id/unlink
  // -------------------------------------------------------------------------
  router.post("/link/:crossProductLinkId/unlink", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    const parsed = unlinkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const correlationId = randomUUID();
    // Express types this as string | string[]; a repeated path segment would
    // yield an array. Coerce narrowly rather than casting — an array here is
    // malformed input, not something to guess at.
    const rawLinkId = req.params.crossProductLinkId;
    const linkId = typeof rawLinkId === "string" ? rawLinkId : "";

    // Ownership is enforced inside the UPDATE's WHERE clause, so a link
    // belonging to another actor and a link that does not exist are
    // indistinguishable here — which is the intended behaviour.
    const tombstone = await deps.links.revokeLink(
      linkId,
      session.actorRef,
      now,
      parsed.data.expectedVersion,
    );

    if (!tombstone) {
      await deps.auditSink.record({
        eventType: "stage2.unlink.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: null,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "identity_linking", scopes: [], outcome: "denied",
        correlationId,
        metadata: { crossProductLinkId: linkId },
      });
      deny(res, 403);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage2.unlink.succeeded",
      occurredAt: now.toISOString(),
      actorId: session.actorRef, subjectId: null,
      operatingContext: "personal",
      authority: { kind: "self" },
      purpose: "identity_linking", scopes: [], outcome: "allowed",
      correlationId,
      metadata: { crossProductLinkId: linkId },
    });

    // Stage 4 share revocation is NOT wired here yet. `unlink()` in the domain
    // layer already computes which grants must be revoked, but no share-grant
    // store exists to revoke them in. Returning a field that claims shares were
    // revoked would be a lie, so this reports only what actually happened.
    res.status(200).json({
      state: "unlinked",
      crossProductLinkId: tombstone.crossProductLinkId,
      tombstonedAt: tombstone.tombstonedAt,
      sharesRevoked: null,
    });
  });

  return router;
}
