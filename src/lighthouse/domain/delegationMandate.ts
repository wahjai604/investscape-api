/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 8 — delegated client portfolio management (Mode D).
 *
 * DISABLED CAPABILITY. DELEGATED_CLIENT_INVESTSCAPE_MANAGEMENT_SCOPE_V0.1 lists
 * 8 unresolved product decisions and states: "Until these decisions and
 * applicable legal/compliance review are complete, Mode D remains a designed but
 * disabled capability." This module is the design; nothing wires it to a route.
 *
 * The identity model is non-negotiable (scope doc §"Non-negotiable identity
 * model"):
 *   - the professional always signs in as themselves;
 *   - the client never shares a password, session or recovery code;
 *   - every request carries a server-resolved delegated-authority identifier;
 *   - the client remains the portfolio subject; the professional is the actor.
 *
 * The single most important control here is self-dealing prevention: a
 * professional can neither create nor accept their own mandate.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  MANDATE_LIFECYCLE, type LifecycleEvent, type LifecycleSnapshot,
  type MandateState, applyLifecycleEvent,
} from "./lifecycle.ts";
import { isProhibitedDelegatedScope } from "./policy.ts";

export const DEFAULT_MANDATE_TTL_DAYS = 90;
export const MANDATE_CHALLENGE_TTL_SECONDS = 86_400; // 24h for accessibility

export interface DelegationRequest {
  readonly requestId: string;
  readonly professionalUserRef: string;
  readonly clientUserRef: string;
  readonly relationshipRef: string;
  /** Proof of a current Relationship OS representation. */
  readonly representationRef: string;
  readonly requestedScopes: readonly string[];
  readonly purpose: string;
  readonly noticeVersion: string;
  /** SHA-256 of the single-use acceptance challenge. */
  readonly challengeHash: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly consumedAt: string | null;
}

export interface DelegationMandate {
  readonly mandateId: string;
  readonly professionalUserRef: string;
  readonly clientUserRef: string;
  readonly relationshipRef: string;
  readonly representationRef: string;
  /** The InvestScape portfolio this mandate is bound to. */
  readonly portfolioRef: string;
  /** Granted permissions. Default empty — everything is off unless granted. */
  readonly scopes: readonly string[];
  readonly purpose: string;
  readonly noticeVersion: string;
  readonly effectiveFrom: string;
  readonly expiresAt: string;
  readonly acceptedByClientAt: string;
  readonly correlationId: string;
  readonly lifecycle: LifecycleSnapshot<MandateState>;
}

/** Client-visible record of what the professional actually did. */
export interface AccessReceipt {
  readonly receiptId: string;
  readonly mandateId: string;
  readonly actorUserRef: string;
  readonly subjectUserRef: string;
  readonly action: string;
  readonly occurredAt: string;
  readonly correlationId: string;
}

export type MandateDenial =
  | "FEATURE_DISABLED"
  | "SELF_DELEGATION_PROHIBITED"
  | "REQUEST_NOT_FOUND"
  | "REQUEST_EXPIRED"
  | "REQUEST_ALREADY_CONSUMED"
  | "CHALLENGE_MISMATCH"
  | "CLIENT_NOT_AUTHENTICATED"
  | "ACCEPTOR_IS_NOT_CLIENT"
  | "REPRESENTATION_NOT_ACTIVE"
  | "PROFESSIONAL_NOT_ELIGIBLE"
  | "PROHIBITED_SCOPE_REQUESTED"
  | "UNKNOWN_SCOPE_REQUESTED"
  | "PURPOSE_REQUIRED"
  | "NOTICE_VERSION_REQUIRED"
  | "ASSISTED_CONSENT_NOT_ENABLED";

export type MandateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: MandateDenial };

export function hashMandateChallenge(challenge: string): string {
  return createHash("sha256").update(challenge).digest("hex");
}

export function generateMandateChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreateRequestInput {
  readonly requestId: string;
  readonly professionalUserRef: string;
  readonly clientUserRef: string;
  readonly relationshipRef: string;
  readonly representationRef: string;
  readonly representationIsActive: boolean;
  readonly professionalIsEligible: boolean;
  readonly requestedScopes: readonly string[];
  readonly knownScopes: ReadonlySet<string>;
  readonly purpose: string;
  readonly noticeVersion: string;
  readonly challenge: string;
  readonly now: Date;
  readonly ttlSeconds?: number;
  readonly correlationId: string;
  readonly isEnabled: boolean;
}

/** Creates a delegation request. The professional may only ASK. */
export function createDelegationRequest(
  input: CreateRequestInput,
): MandateResult<DelegationRequest> {
  if (!input.isEnabled) return { ok: false, reason: "FEATURE_DISABLED" };

  // Self-dealing guard #1.
  if (input.professionalUserRef === input.clientUserRef) {
    return { ok: false, reason: "SELF_DELEGATION_PROHIBITED" };
  }
  if (!input.representationIsActive) {
    return { ok: false, reason: "REPRESENTATION_NOT_ACTIVE" };
  }
  if (!input.professionalIsEligible) {
    return { ok: false, reason: "PROFESSIONAL_NOT_ELIGIBLE" };
  }
  if (!input.purpose?.trim()) return { ok: false, reason: "PURPOSE_REQUIRED" };
  if (!input.noticeVersion) return { ok: false, reason: "NOTICE_VERSION_REQUIRED" };

  for (const scope of input.requestedScopes) {
    if (isProhibitedDelegatedScope(scope)) {
      return { ok: false, reason: "PROHIBITED_SCOPE_REQUESTED" };
    }
    if (!input.knownScopes.has(scope)) {
      return { ok: false, reason: "UNKNOWN_SCOPE_REQUESTED" };
    }
  }

  const ttl = input.ttlSeconds ?? MANDATE_CHALLENGE_TTL_SECONDS;
  return {
    ok: true,
    value: {
      requestId: input.requestId,
      professionalUserRef: input.professionalUserRef,
      clientUserRef: input.clientUserRef,
      relationshipRef: input.relationshipRef,
      representationRef: input.representationRef,
      requestedScopes: [...input.requestedScopes],
      purpose: input.purpose,
      noticeVersion: input.noticeVersion,
      challengeHash: hashMandateChallenge(input.challenge),
      expiresAt: new Date(input.now.getTime() + ttl * 1000).toISOString(),
      correlationId: input.correlationId,
      consumedAt: null,
    },
  };
}

export interface AcceptMandateInput {
  readonly request: DelegationRequest | null;
  readonly presentedChallenge: string;
  /** The authenticated acceptor. MUST be the client, in their own session. */
  readonly authenticatedUserRef: string;
  readonly clientIsAuthenticated: boolean;
  readonly portfolioRef: string;
  readonly mandateId: string;
  readonly now: Date;
  readonly ttlDays?: number;
  readonly correlationId: string;
  readonly isEnabled: boolean;
  /** Assisted consent is a separate, separately-gated capability. */
  readonly assistedConsent?: { readonly requested: boolean; readonly enabled: boolean };
}

/**
 * Client acceptance. This is where self-dealing is finally impossible.
 *
 * Even if a professional forged a request, they cannot accept it: acceptance
 * requires an authenticated session belonging to the CLIENT, and the acceptor
 * is compared against both the client and the professional.
 */
export function acceptDelegationMandate(
  input: AcceptMandateInput,
): MandateResult<DelegationMandate> {
  if (!input.isEnabled) return { ok: false, reason: "FEATURE_DISABLED" };

  const request = input.request;
  if (!request) return { ok: false, reason: "REQUEST_NOT_FOUND" };
  if (request.consumedAt !== null) {
    return { ok: false, reason: "REQUEST_ALREADY_CONSUMED" };
  }
  if (new Date(request.expiresAt) <= input.now) {
    return { ok: false, reason: "REQUEST_EXPIRED" };
  }

  // Assisted consent must be explicitly enabled; it is not on by default.
  if (input.assistedConsent?.requested && !input.assistedConsent.enabled) {
    return { ok: false, reason: "ASSISTED_CONSENT_NOT_ENABLED" };
  }

  if (!input.clientIsAuthenticated) {
    return { ok: false, reason: "CLIENT_NOT_AUTHENTICATED" };
  }

  // Self-dealing guard #2 — the decisive one.
  if (input.authenticatedUserRef === request.professionalUserRef) {
    return { ok: false, reason: "SELF_DELEGATION_PROHIBITED" };
  }
  if (input.authenticatedUserRef !== request.clientUserRef) {
    return { ok: false, reason: "ACCEPTOR_IS_NOT_CLIENT" };
  }

  const presented = Buffer.from(hashMandateChallenge(input.presentedChallenge), "hex");
  const expected = Buffer.from(request.challengeHash, "hex");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: "CHALLENGE_MISMATCH" };
  }

  const nowIso = input.now.toISOString();
  const ttlDays = input.ttlDays ?? DEFAULT_MANDATE_TTL_DAYS;

  return {
    ok: true,
    value: {
      mandateId: input.mandateId,
      professionalUserRef: request.professionalUserRef,
      clientUserRef: request.clientUserRef,
      relationshipRef: request.relationshipRef,
      representationRef: request.representationRef,
      portfolioRef: input.portfolioRef,
      scopes: [...request.requestedScopes],
      purpose: request.purpose,
      noticeVersion: request.noticeVersion,
      effectiveFrom: nowIso,
      expiresAt: new Date(
        input.now.getTime() + ttlDays * 86_400_000,
      ).toISOString(),
      acceptedByClientAt: nowIso,
      correlationId: input.correlationId,
      lifecycle: {
        state: "active", version: 1, occurredAt: nowIso, appliedEventIds: [],
      },
    },
  };
}

/**
 * Whether a mandate currently authorizes an action.
 *
 * Representation and professional eligibility are checked EVERY time, not only
 * at acceptance: "Loss of professional eligibility or representation suspends
 * delegated access."
 */
export function mandatePermits(
  mandate: DelegationMandate,
  scope: string,
  conditions: {
    readonly now: Date;
    readonly representationIsActive: boolean;
    readonly professionalIsEligible: boolean;
  },
): { readonly ok: boolean; readonly reason?: string } {
  if (mandate.lifecycle.state !== "active") return { ok: false, reason: "MANDATE_NOT_ACTIVE" };
  if (new Date(mandate.expiresAt) <= conditions.now) return { ok: false, reason: "MANDATE_EXPIRED" };
  if (new Date(mandate.effectiveFrom) > conditions.now) return { ok: false, reason: "MANDATE_NOT_YET_EFFECTIVE" };
  if (!conditions.representationIsActive) return { ok: false, reason: "REPRESENTATION_ENDED" };
  if (!conditions.professionalIsEligible) return { ok: false, reason: "ELIGIBILITY_LOST" };
  if (isProhibitedDelegatedScope(scope)) return { ok: false, reason: "SCOPE_PROHIBITED" };
  if (!mandate.scopes.includes(scope)) return { ok: false, reason: "SCOPE_NOT_GRANTED" };
  return { ok: true };
}

export function applyMandateEvent(
  mandate: DelegationMandate,
  event: LifecycleEvent<MandateState>,
) {
  return applyLifecycleEvent(MANDATE_LIFECYCLE, mandate.lifecycle, event);
}

/** Builds the client-visible receipt for a delegated action. */
export function buildAccessReceipt(
  mandate: DelegationMandate,
  action: string,
  receiptId: string,
  now: Date,
): AccessReceipt {
  return {
    receiptId,
    mandateId: mandate.mandateId,
    actorUserRef: mandate.professionalUserRef,
    subjectUserRef: mandate.clientUserRef,
    action,
    occurredAt: now.toISOString(),
    correlationId: mandate.correlationId,
  };
}

/**
 * Actions requiring fresh client confirmation.
 *
 * PROVISIONAL: decision #3 in the scope doc ("Which actions are routine
 * delegated operations, and which require per-action client confirmation?") is
 * unresolved, so this list is a proposal, deliberately conservative.
 */
export const MATERIAL_ACTIONS_REQUIRING_APPROVAL: readonly string[] = [
  "delegated.report.prepare",
  "delegated.result.share_back",
];

export function requiresClientApproval(action: string): boolean {
  return MATERIAL_ACTIONS_REQUIRING_APPROVAL.includes(action);
}
