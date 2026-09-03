/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Fail-closed authorization guard for every cross-product operation.
 *
 * The central rule (STAGES_2_TO_8 prompt, "Required feature flags"):
 *   "Flags must not bypass authorization. Enabling a flag merely makes a fully
 *    authorized flow available."
 *
 * So this guard evaluates BOTH, and a flag can only ever subtract permission,
 * never add it. There is no branch in which `flagEnabled === true` skips a
 * check. The test `an enabled flag never substitutes for authority` pins that.
 *
 * Invariant 4: authentication, payment, entitlement, professional eligibility,
 * representation, consent, delegation, sharing and administration are separate
 * authorities and none implies another. `requiredAuthority` therefore names the
 * ONE authority kind that legitimises an operation; holding a different one is
 * not sufficient, however privileged it looks.
 */

import type { AuditAuthorityKind, AuditEvent, AuditSink } from "../audit/auditEvent.ts";
import { isKnownFeatureFlag } from "../config/featureFlags.ts";
import {
  type ContextDenialReason,
  type OperatingContextKind,
  type ResolvedOperatingContext,
} from "./operatingContext.ts";

export type DenialReason =
  | ContextDenialReason
  | "FEATURE_FLAG_DISABLED"
  | "UNKNOWN_FEATURE_FLAG"
  | "UNKNOWN_SCOPE"
  | "INSUFFICIENT_SCOPE"
  | "WRONG_AUTHORITY_KIND"
  | "CONTEXT_NOT_PERMITTED"
  | "PURPOSE_REQUIRED";

export type PolicyDecision =
  | { readonly allowed: true; readonly context: ResolvedOperatingContext }
  | { readonly allowed: false; readonly reason: DenialReason };

export interface PolicyRequest {
  /** The server-side flag gating this capability. */
  readonly featureFlag: string;
  /** A context ALREADY resolved by `resolveOperatingContext`. */
  readonly context: ResolvedOperatingContext;
  /** Scopes the operation needs. Every one must be present. */
  readonly requiredScopes: readonly string[];
  /** The one authority kind that legitimises this operation. */
  readonly requiredAuthority: AuditAuthorityKind;
  /** Contexts in which this operation is meaningful at all. */
  readonly permittedContexts: readonly OperatingContextKind[];
  /** Purpose limitation (PRIVACY_SECURITY §2). Required for cross-product reads. */
  readonly purpose?: string;
  readonly requirePurpose?: boolean;
}

export interface PolicyDependencies {
  readonly isFeatureEnabled: (flag: string) => boolean;
  /** The complete set of scopes this build understands. Unknown => fail closed. */
  readonly knownScopes: ReadonlySet<string>;
  readonly auditSink?: AuditSink;
  readonly now?: () => Date;
}

/**
 * Evaluates a policy request. Returns a decision; never throws for a denial.
 *
 * Every path records an audit event when a sink is supplied, so a denial is as
 * traceable as an approval (invariant 6).
 */
export async function authorize(
  request: PolicyRequest,
  deps: PolicyDependencies,
): Promise<PolicyDecision> {
  const decision = evaluate(request, deps);

  if (deps.auditSink) {
    const now = (deps.now ?? (() => new Date()))();
    const event: AuditEvent = {
      eventType: `policy.${request.featureFlag}`,
      occurredAt: now.toISOString(),
      actorId: request.context.actorId,
      subjectId: request.context.subjectId,
      operatingContext: request.context.kind,
      authority: request.context.authority,
      purpose: request.purpose ?? null,
      scopes: request.requiredScopes,
      outcome: decision.allowed ? "allowed" : "denied",
      correlationId: request.context.correlationId,
      metadata: decision.allowed ? undefined : { reason: decision.reason },
    };
    await deps.auditSink.record(event);
  }

  return decision;
}

function evaluate(request: PolicyRequest, deps: PolicyDependencies): PolicyDecision {
  // 1. Unknown flag names fail closed (invariant 8) — a typo must not open a door.
  if (!isKnownFeatureFlag(request.featureFlag)) {
    return { allowed: false, reason: "UNKNOWN_FEATURE_FLAG" };
  }

  // 2. Disabled flag => unavailable. This SUBTRACTS permission only.
  if (!deps.isFeatureEnabled(request.featureFlag)) {
    return { allowed: false, reason: "FEATURE_FLAG_DISABLED" };
  }

  // 3..6 below still run in full when the flag is enabled. There is no
  //      short-circuit that treats an enabled flag as authority.

  // 3. The context must be one where this operation is meaningful.
  if (!request.permittedContexts.includes(request.context.kind)) {
    return { allowed: false, reason: "CONTEXT_NOT_PERMITTED" };
  }

  // 4. The right KIND of authority. A paid subscription is not a mandate;
  //    an admin assignment is not consent.
  if (request.context.authority.kind !== request.requiredAuthority) {
    return { allowed: false, reason: "WRONG_AUTHORITY_KIND" };
  }

  // 5. Purpose limitation.
  if (request.requirePurpose && !request.purpose) {
    return { allowed: false, reason: "PURPOSE_REQUIRED" };
  }

  // 6. Scopes: every required scope must be known AND held.
  const held = new Set(request.context.scopes);
  for (const scope of request.requiredScopes) {
    if (!deps.knownScopes.has(scope)) {
      return { allowed: false, reason: "UNKNOWN_SCOPE" };
    }
    if (!held.has(scope)) {
      return { allowed: false, reason: "INSUFFICIENT_SCOPE" };
    }
  }

  return { allowed: true, context: request.context };
}

/**
 * InvestScape administrative scopes.
 * Source: CROSS_PRODUCT_ADMINISTRATION_HANDOFF_V0.1 §"InvestScape administrative
 * scopes Claude should implement". Billing administration is deliberately NOT
 * in this list — it stays a separate authority.
 */
export const INVESTSCAPE_ADMIN_SCOPES = [
  "investscape.configuration.read",
  "investscape.configuration.manage",
  "investscape.analysis_access.review",
  "investscape.reference.review",
  "investscape.integration_health.read",
  "investscape.retention.manage",
  "investscape.privacy_request.manage",
  "investscape.incident.review",
] as const;

/**
 * Delegated portfolio permissions (Mode D).
 * Source: DELEGATED_CLIENT_INVESTSCAPE_MANAGEMENT_SCOPE_V0.1 §"Initial
 * permission matrix". All default OFF and are granted individually.
 */
export const DELEGATED_PORTFOLIO_SCOPES = [
  "delegated.portfolio.view",
  "delegated.analysis.create",
  "delegated.analysis.edit",
  "delegated.analysis.run",
  "delegated.information.attach",
  "delegated.scenario.organize",
  "delegated.report.prepare",
  "delegated.result.share_back",
  "delegated.client.request_review",
] as const;

/**
 * Explicitly prohibited in the initial delegated mandate. Kept as a named set so
 * a future elevated workflow has to remove an entry deliberately rather than
 * simply forgetting to block it.
 */
export const DELEGATED_PROHIBITED_SCOPES = [
  "delegated.auth.change",
  "delegated.recovery.change",
  "delegated.payment.view",
  "delegated.payment.change",
  "delegated.subscription.purchase",
  "delegated.subscription.change",
  "delegated.export.bulk",
  "delegated.delete.permanent",
  "delegated.ownership.transfer",
  "delegated.delegation.onward",
  "delegated.relationship.outside_bound",
] as const;

const PROHIBITED: ReadonlySet<string> = new Set(DELEGATED_PROHIBITED_SCOPES);

/** True when a scope must never appear in a v1 delegation mandate. */
export function isProhibitedDelegatedScope(scope: string): boolean {
  return PROHIBITED.has(scope);
}

/** Every scope this build understands. Anything else fails closed. */
export const KNOWN_SCOPES: ReadonlySet<string> = new Set<string>([
  ...INVESTSCAPE_ADMIN_SCOPES,
  ...DELEGATED_PORTFOLIO_SCOPES,
  // Stage 1 launch context scopes, as emitted by the Relationship OS producer.
  "property.basic",
  "finance.summary",
  // Stage 3/4 client-owned workspace and sharing.
  "workspace.availability.read",
  "share.grant.create",
  "share.grant.revoke",
  "share.grant.read",
  // Personal.
  "personal.portfolio.read",
  "personal.portfolio.write",
]);
