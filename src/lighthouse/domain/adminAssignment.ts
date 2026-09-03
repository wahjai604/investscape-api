/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 7 — cross-product administration (InvestScape side).
 *
 * Source: CROSS_PRODUCT_ADMINISTRATION_HANDOFF_V0.1 §"InvestScape
 * administrative scopes Claude should implement" (see `INVESTSCAPE_ADMIN_SCOPES`
 * in ./policy.ts). Billing administration is deliberately out of scope — it
 * stays a separate authority, never grantable through this module.
 *
 * THE CONTROL THAT MATTERS HERE: privilege escalation, not self-dealing.
 * Stage 8's guard stops a professional profiting from their own delegation.
 * Stage 7's problem is different — an admin granting scopes THEY DO NOT
 * THEMSELVES HOLD, minting authority from nothing. `createAdminAssignment`
 * enforces that every requested scope must already be present in the
 * granter's own current, effective scopes. A granter with only
 * `investscape.incident.review` can never hand out
 * `investscape.retention.manage`, no matter what the request claims.
 *
 * BOOTSTRAP: the very first admin cannot be granted by another admin, because
 * none exists. `effectiveScopesFor` resolves this OUTSIDE the database: an
 * actor matching the server-owned `seedAdminActorRef` (from
 * `LIGHTHOUSE_SEED_ADMIN_ACTOR_REF`, read by the caller, never by this file)
 * is treated as holding every known admin scope, with no database row and no
 * route that can produce that state. Every other assignment — including any
 * ADDITIONAL scopes for the seed actor beyond what bootstrap already implies —
 * goes through the normal grant flow below. Absence of the env var means the
 * seed actor is nobody; this module never invents an admin from missing
 * configuration.
 */

import {
  ADMIN_ASSIGNMENT_LIFECYCLE, type AdminAssignmentState, type LifecycleEvent,
  type LifecycleSnapshot, applyLifecycleEvent,
} from "./lifecycle.ts";
import { INVESTSCAPE_ADMIN_SCOPES } from "./policy.ts";

const KNOWN_ADMIN_SCOPES: ReadonlySet<string> = new Set(INVESTSCAPE_ADMIN_SCOPES);

/**
 * The one scope that authorizes granting or revoking OTHER admin assignments.
 * Holding any of the other 7 scopes never implies this one — reviewing
 * incidents does not imply the authority to manage who else can.
 */
export const ADMIN_MANAGEMENT_SCOPE = "investscape.configuration.manage" as const;

export interface AdminAssignment {
  readonly assignmentId: string;
  readonly granteeActorRef: string;
  readonly grantedByActorRef: string;
  readonly scopes: readonly string[];
  readonly purpose: string;
  readonly effectiveFrom: string;
  readonly expiresAt: string | null;
  readonly correlationId: string;
  readonly lifecycle: LifecycleSnapshot<AdminAssignmentState>;
}

export type AdminAssignmentDenial =
  | "FEATURE_DISABLED"
  | "GRANTER_NOT_AUTHORIZED"
  | "NO_SCOPES_REQUESTED"
  | "UNKNOWN_SCOPE_REQUESTED"
  | "SCOPE_EXCEEDS_GRANTER_AUTHORITY"
  | "PURPOSE_REQUIRED"
  | "EXPIRY_IN_PAST";

export type AdminAssignmentResult =
  | { readonly ok: true; readonly assignment: AdminAssignment }
  | { readonly ok: false; readonly reason: AdminAssignmentDenial };

/**
 * Resolves an actor's CURRENT effective admin scopes, folding in the
 * bootstrap override.
 *
 * Pure function: the caller supplies both the seed ref (from env, or
 * undefined if unset) and the actor's stored scopes (from active, unexpired
 * assignments only — the caller is responsible for that filtering, same
 * discipline as `sqlAuthorityLookup` filtering to `status = 'active'` in SQL
 * rather than trusting application code to remember).
 */
export function effectiveScopesFor(
  actorRef: string,
  seedAdminActorRef: string | undefined,
  storedScopes: readonly string[],
): readonly string[] {
  if (seedAdminActorRef && actorRef === seedAdminActorRef) {
    return INVESTSCAPE_ADMIN_SCOPES;
  }
  return storedScopes;
}

export interface CreateAdminAssignmentInput {
  readonly assignmentId: string;
  readonly granterActorRef: string;
  /** Resolved via `effectiveScopesFor` before this is called. */
  readonly granterEffectiveScopes: readonly string[];
  readonly granteeActorRef: string;
  readonly requestedScopes: readonly string[];
  readonly purpose: string;
  readonly expiresAt: string | null;
  readonly now: Date;
  readonly correlationId: string;
  readonly isEnabled: boolean;
}

export function createAdminAssignment(
  input: CreateAdminAssignmentInput,
): AdminAssignmentResult {
  if (!input.isEnabled) return { ok: false, reason: "FEATURE_DISABLED" };

  // The granter must hold the management scope itself. Holding it via
  // bootstrap (effectiveScopesFor having returned every scope) counts —
  // that is the whole point of the bootstrap path.
  if (!input.granterEffectiveScopes.includes(ADMIN_MANAGEMENT_SCOPE)) {
    return { ok: false, reason: "GRANTER_NOT_AUTHORIZED" };
  }

  if (input.requestedScopes.length === 0) {
    return { ok: false, reason: "NO_SCOPES_REQUESTED" };
  }

  const granterScopeSet = new Set(input.granterEffectiveScopes);
  for (const scope of input.requestedScopes) {
    if (!KNOWN_ADMIN_SCOPES.has(scope)) {
      return { ok: false, reason: "UNKNOWN_SCOPE_REQUESTED" };
    }
    // The escalation guard: a granter can only hand out scopes they
    // currently hold themselves. This also makes self-grants safe by
    // construction — a granter "elevating" themselves can never request a
    // scope beyond what they already have, so a self-grant is a no-op at
    // best, never a privilege gain.
    if (!granterScopeSet.has(scope)) {
      return { ok: false, reason: "SCOPE_EXCEEDS_GRANTER_AUTHORITY" };
    }
  }

  if (!input.purpose?.trim()) return { ok: false, reason: "PURPOSE_REQUIRED" };
  if (input.expiresAt && new Date(input.expiresAt) <= input.now) {
    return { ok: false, reason: "EXPIRY_IN_PAST" };
  }

  const nowIso = input.now.toISOString();
  return {
    ok: true,
    assignment: {
      assignmentId: input.assignmentId,
      granteeActorRef: input.granteeActorRef,
      grantedByActorRef: input.granterActorRef,
      scopes: [...input.requestedScopes],
      purpose: input.purpose,
      effectiveFrom: nowIso,
      expiresAt: input.expiresAt,
      correlationId: input.correlationId,
      lifecycle: {
        state: "active", version: 1, occurredAt: nowIso, appliedEventIds: [],
      },
    },
  };
}

/** True when an assignment currently grants the given scope. */
export function assignmentPermits(
  assignment: AdminAssignment,
  scope: string,
  now: Date,
): boolean {
  if (assignment.lifecycle.state !== "active") return false;
  if (new Date(assignment.effectiveFrom) > now) return false;
  if (assignment.expiresAt && new Date(assignment.expiresAt) <= now) return false;
  if (!KNOWN_ADMIN_SCOPES.has(scope)) return false;
  return assignment.scopes.includes(scope);
}

export function applyAdminAssignmentEvent(
  assignment: AdminAssignment,
  event: LifecycleEvent<AdminAssignmentState>,
) {
  return applyLifecycleEvent(ADMIN_ASSIGNMENT_LIFECYCLE, assignment.lifecycle, event);
}

export type RevocationDenial =
  | "FEATURE_DISABLED"
  | "REVOKER_NOT_AUTHORIZED"
  | "ASSIGNMENT_NOT_ACTIVE"
  | "LAST_ADMIN_LOCKOUT";

export type RevocationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: RevocationDenial };

/**
 * Authorization check ONLY — the actual state transition is a lifecycle
 * event applied by the repository (compare-and-set in SQL, same as every
 * other stage), not performed here. This function exists so the "who is
 * allowed to revoke" rule lives in one tested place rather than being
 * re-derived at the route layer.
 *
 * `otherActiveManagementHolderCount` is the count of OTHER active, unexpired
 * assignments (not this one) that currently include `ADMIN_MANAGEMENT_SCOPE`
 * — supplied by the caller from a repository count, same discipline as
 * `granterEffectiveScopes` above: this file never queries anything itself.
 * The bootstrap seed actor is deliberately NOT counted by the caller, so this
 * guard cannot be defeated by revoking every real assignment down to "zero
 * held in the database" while the seed ref still silently provides a
 * way back in — the lockout guard and the bootstrap escape hatch are
 * independent safety nets, not substitutes for each other.
 *
 * Only fires when the assignment BEING revoked itself carries the management
 * scope; revoking a scope-limited assignment never risks a lockout.
 */
export function authorizeRevocation(
  assignment: AdminAssignment,
  revokerEffectiveScopes: readonly string[],
  isEnabled: boolean,
  otherActiveManagementHolderCount: number,
): RevocationResult {
  if (!isEnabled) return { ok: false, reason: "FEATURE_DISABLED" };
  if (!revokerEffectiveScopes.includes(ADMIN_MANAGEMENT_SCOPE)) {
    return { ok: false, reason: "REVOKER_NOT_AUTHORIZED" };
  }
  if (assignment.lifecycle.state !== "active") {
    return { ok: false, reason: "ASSIGNMENT_NOT_ACTIVE" };
  }
  if (
    assignment.scopes.includes(ADMIN_MANAGEMENT_SCOPE) &&
    otherActiveManagementHolderCount <= 0
  ) {
    return { ok: false, reason: "LAST_ADMIN_LOCKOUT" };
  }
  return { ok: true };
}
