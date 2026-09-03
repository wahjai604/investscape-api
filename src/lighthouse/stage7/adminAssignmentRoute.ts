/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 7 HTTP surface — cross-product administration.
 *
 * PROVISIONAL. Nothing here is reachable until
 * LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION is deliberately enabled, which
 * it is not.
 *
 * ONE AUTHORITY, NOT TWO
 *
 *   POST /admin/assignments                session-authenticated (the granter)
 *   GET  /admin/assignments                 session-authenticated (the caller's own)
 *   POST /admin/assignments/:id/revoke      session-authenticated (the revoker)
 *
 * THE ESCALATION GUARD, RESOLVED HERE THEN ENFORCED IN THE DOMAIN LAYER
 *
 * The route never trusts a body-supplied notion of "what scopes I hold". It
 * resolves the caller's TRUE effective scopes via
 * `effectiveScopesFor(session.actorRef, seedAdminActorRef, storedScopes)` —
 * folding in the bootstrap override — and hands that to
 * `createAdminAssignment()` as `granterEffectiveScopes`. The actual "can this
 * granter hand out this scope" decision still lives entirely in the domain
 * layer; this route only assembles the inputs honestly.
 *
 * REVOKE: AUTHORIZATION HAPPENS HERE, NOT IN THE REPOSITORY
 *
 * Unlike every other stage, the repository's `revoke()` has no ownership
 * predicate — the revoker is essentially never the assignment's own grantee.
 * So this route:
 *   1. loads the assignment,
 *   2. resolves the revoker's effective scopes the same way as create,
 *   3. asks the repository how many OTHER active assignments hold the
 *      management scope (the lockout guard's input),
 *   4. calls `authorizeRevocation()` from the domain layer,
 *   5. only on `{ ok: true }` calls the repository's atomic compare-and-set
 *      `revoke()`.
 * If any step between 1 and 4 fails, the repository's mutating call is never
 * reached — there is no code path that can revoke without an explicit
 * `authorizeRevocation` approval immediately beforehand.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isFeatureEnabled } from "../config/featureFlags.ts";
import type { AuditSink } from "../audit/auditEvent.ts";
import {
  effectiveScopesFor,
  authorizeRevocation,
  type AdminAssignmentDenial,
  type RevocationDenial,
} from "../domain/adminAssignment.ts";
import { INVESTSCAPE_ADMIN_SCOPES } from "../domain/policy.ts";
import type { AdminAssignmentRepository } from "./adminAssignmentRepository.ts";

const FLAG = "lighthouse.cross_product_administration";

const MAX_STRING = 256;

const createAssignmentSchema = z
  .object({
    granteeActorRef: z.string().min(1).max(MAX_STRING),
    requestedScopes: z.array(z.string().min(1).max(128)).min(1).max(INVESTSCAPE_ADMIN_SCOPES.length),
    purpose: z.string().min(1).max(280),
    expiresAt: z.string().datetime().nullable(),
  })
  .strict();

const revokeSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export interface AdminAssignmentRouteDependencies {
  readonly assignments: AdminAssignmentRepository;
  readonly auditSink: AuditSink;
  readonly now: () => Date;
  readonly newAssignmentId: () => string;
  /** From LIGHTHOUSE_SEED_ADMIN_ACTOR_REF. Undefined means bootstrap is off. */
  readonly seedAdminActorRef: string | undefined;
  readonly env?: Record<string, string | undefined>;
}

/** Single opaque denial. Reasons are audited server-side, never returned. */
function deny(res: Response, status: number): void {
  res.status(status).json({ state: "denied" });
}

/**
 * Denials the caller is entitled to see the reason for, because the reason
 * describes only their OWN submitted data and reveals nothing about another
 * actor's authority or another assignment's existence. Same distinction
 * Stage 4 made: authorization-shaped denials (who is allowed to do what) stay
 * opaque; validation-shaped denials (what the caller themselves submitted)
 * are safe to echo.
 */
const VALIDATION_SHAPED_CREATE_DENIALS: ReadonlySet<AdminAssignmentDenial> = new Set([
  "NO_SCOPES_REQUESTED",
  "UNKNOWN_SCOPE_REQUESTED",
  "PURPOSE_REQUIRED",
  "EXPIRY_IN_PAST",
]);

// GRANTER_NOT_AUTHORIZED and SCOPE_EXCEEDS_GRANTER_AUTHORITY are deliberately
// NOT in the validation-shaped set above, even though the escalation guard
// spec calls them out by name for TEST assertions — those are authorization
// facts about the granter's own authority, not about the shape of their
// input, and are kept opaque at the HTTP layer (audited, not returned) same
// as REVOKER_NOT_AUTHORIZED below. FEATURE_DISABLED never reaches this set
// because the route's flag gate short-circuits first.

const VALIDATION_SHAPED_REVOKE_DENIALS: ReadonlySet<RevocationDenial> = new Set([
  // ASSIGNMENT_NOT_ACTIVE describes only the state of the specific row the
  // caller is themselves acting on (already-revoked / stale), not another
  // actor's authority — safe to echo, same reasoning as Stage 4's
  // "already terminal" being distinguishable from "not yours" only at the
  // repository layer, never at the response.
  "ASSIGNMENT_NOT_ACTIVE",
]);

export function createAdminAssignmentRouter(deps: AdminAssignmentRouteDependencies): Router {
  const router = Router();

  const enabled = (): boolean => isFeatureEnabled(FLAG, deps.env ?? process.env);

  // -------------------------------------------------------------------------
  // POST /admin/assignments
  // -------------------------------------------------------------------------
  router.post("/admin/assignments", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    const parsed = createAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ state: "invalid" });
      return;
    }

    const now = deps.now();
    const correlationId = randomUUID();
    const assignmentId = deps.newAssignmentId();

    const storedScopes = await deps.assignments.findActiveScopesForActor(session.actorRef, now);
    const granterEffectiveScopes = effectiveScopesFor(
      session.actorRef,
      deps.seedAdminActorRef,
      storedScopes,
    );

    const outcome = await deps.assignments.create({
      assignmentId,
      granterActorRef: session.actorRef,
      granterEffectiveScopes,
      granteeActorRef: parsed.data.granteeActorRef,
      requestedScopes: parsed.data.requestedScopes,
      purpose: parsed.data.purpose,
      expiresAt: parsed.data.expiresAt,
      now,
      correlationId,
      isEnabled: true,
    });

    if (!outcome.ok) {
      await deps.auditSink.record({
        eventType: "stage7.assignment.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: parsed.data.granteeActorRef,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "cross_product_administration", scopes: parsed.data.requestedScopes,
        outcome: "denied",
        correlationId,
        metadata: { reason: outcome.reason },
      });

      if (VALIDATION_SHAPED_CREATE_DENIALS.has(outcome.reason)) {
        res.status(400).json({ state: "invalid", reason: outcome.reason });
        return;
      }
      // FEATURE_DISABLED, GRANTER_NOT_AUTHORIZED, SCOPE_EXCEEDS_GRANTER_AUTHORITY:
      // authorization failures. Opaque, so the response cannot be used to
      // probe another actor's held scopes.
      deny(res, 403);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage7.assignment.created",
      occurredAt: now.toISOString(),
      actorId: session.actorRef,
      subjectId: outcome.assignment.granteeActorRef,
      operatingContext: "personal",
      authority: { kind: "self" },
      purpose: "cross_product_administration", scopes: outcome.assignment.scopes,
      outcome: "allowed",
      correlationId,
      metadata: { assignmentId: outcome.assignment.assignmentId },
    });

    res.status(201).json({
      state: "created",
      assignmentId: outcome.assignment.assignmentId,
      granteeActorRef: outcome.assignment.granteeActorRef,
      scopes: outcome.assignment.scopes,
      purpose: outcome.assignment.purpose,
      effectiveFrom: outcome.assignment.effectiveFrom,
      expiresAt: outcome.assignment.expiresAt,
      version: outcome.assignment.lifecycle.version,
    });
  });

  // -------------------------------------------------------------------------
  // GET /admin/assignments — the caller's OWN assignments (as grantee), plus
  // their own current effective scopes.
  // -------------------------------------------------------------------------
  router.get("/admin/assignments", async (req: Request, res: Response) => {
    if (!enabled()) {
      res.status(503).json({ state: "unavailable" });
      return;
    }
    const session = req.lighthouseSession;
    if (!session) {
      deny(res, 401);
      return;
    }

    const now = deps.now();
    const storedScopes = await deps.assignments.findActiveScopesForActor(session.actorRef, now);
    const effectiveScopes = effectiveScopesFor(session.actorRef, deps.seedAdminActorRef, storedScopes);

    // Scoped by the session's actor ref inside the query. No parameter a
    // caller could supply widens this.
    const assignments = await deps.assignments.findActiveAssignmentsForActor(session.actorRef, now);

    res.status(200).json({
      state: "ok",
      effectiveScopes,
      assignments: assignments.map((assignment) => ({
        assignmentId: assignment.assignmentId,
        grantedByActorRef: assignment.grantedByActorRef,
        scopes: assignment.scopes,
        purpose: assignment.purpose,
        effectiveFrom: assignment.effectiveFrom,
        expiresAt: assignment.expiresAt,
        state: assignment.lifecycle.state,
        version: assignment.lifecycle.version,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/assignments/:assignmentId/revoke
  // -------------------------------------------------------------------------
  router.post("/admin/assignments/:assignmentId/revoke", async (req: Request, res: Response) => {
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
    const rawId = req.params.assignmentId;
    const assignmentId = typeof rawId === "string" ? rawId : "";

    const assignment = await deps.assignments.findById(assignmentId);
    if (!assignment) {
      await deps.auditSink.record({
        eventType: "stage7.assignment.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: null,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "cross_product_administration", scopes: [], outcome: "denied",
        correlationId,
        metadata: { assignmentId, reason: "NOT_FOUND" },
      });
      // Deliberately the same shape as every other revoke denial below — a
      // missing assignment and an unauthorized revoker must be
      // indistinguishable to the caller.
      deny(res, 403);
      return;
    }

    const storedScopes = await deps.assignments.findActiveScopesForActor(session.actorRef, now);
    const revokerEffectiveScopes = effectiveScopesFor(
      session.actorRef,
      deps.seedAdminActorRef,
      storedScopes,
    );

    const otherHolderCount = await deps.assignments.countOtherActiveManagementHolders(
      assignmentId,
      now,
    );

    const decision = authorizeRevocation(assignment, revokerEffectiveScopes, true, otherHolderCount);

    if (!decision.ok) {
      await deps.auditSink.record({
        eventType: "stage7.assignment.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: assignment.granteeActorRef,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "cross_product_administration", scopes: [], outcome: "denied",
        correlationId,
        metadata: { assignmentId, reason: decision.reason },
      });

      if (VALIDATION_SHAPED_REVOKE_DENIALS.has(decision.reason)) {
        res.status(400).json({ state: "invalid", reason: decision.reason });
        return;
      }
      // FEATURE_DISABLED, REVOKER_NOT_AUTHORIZED, LAST_ADMIN_LOCKOUT:
      // authorization-shaped. Opaque — the response must not tell an
      // unauthorized caller "you were one holder away from succeeding".
      deny(res, 403);
      return;
    }

    // Authorization already approved above. This call cannot succeed without
    // that immediately-preceding `authorizeRevocation` approval — there is no
    // other path to it.
    const revocation = await deps.assignments.revoke(assignmentId, parsed.data.expectedVersion, now);

    if (!revocation) {
      // Authorized, but the compare-and-set lost a race (stale version /
      // already revoked by a concurrent request between the check above and
      // now). Opaque for the same reason as Stage 2/4's revoke.
      await deps.auditSink.record({
        eventType: "stage7.assignment.denied",
        occurredAt: now.toISOString(),
        actorId: session.actorRef, subjectId: assignment.granteeActorRef,
        operatingContext: "personal",
        authority: { kind: "self" },
        purpose: "cross_product_administration", scopes: [], outcome: "denied",
        correlationId,
        metadata: { assignmentId, reason: "STALE_VERSION" },
      });
      deny(res, 409);
      return;
    }

    await deps.auditSink.record({
      eventType: "stage7.assignment.revoked",
      occurredAt: now.toISOString(),
      actorId: session.actorRef, subjectId: assignment.granteeActorRef,
      operatingContext: "personal",
      authority: { kind: "self" },
      purpose: "cross_product_administration", scopes: [], outcome: "allowed",
      correlationId,
      metadata: { assignmentId },
    });

    res.status(200).json({
      state: "revoked",
      assignmentId: revocation.assignmentId,
      revokedAt: revocation.revokedAt,
    });
  });

  return router;
}
