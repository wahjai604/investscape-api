/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 4 — client-selected sharing.
 *
 * The client, from their own independent workspace, selects specific analyses,
 * specific fields, a specific Relationship OS relationship, and a purpose.
 *
 * Three rules from the receiver prompt drive this design:
 *   §4/§10  "Linking is not sharing. Subscription is not sharing."
 *   §11     "Default all optional fields off."
 *   §14     "A cross-product link must not enable queries for unshared analyses.
 *            Enforce this in server authorization and tests, not merely by
 *            hiding UI."
 *
 * `projectSharedSummary` is a WHITELIST COPY, not a delete-list. A new internal
 * analysis field added next year is excluded by default rather than leaking
 * until somebody remembers to blocklist it.
 */

import {
  SHARE_GRANT_LIFECYCLE, type LifecycleEvent, type LifecycleSnapshot,
  type ShareGrantState, applyLifecycleEvent,
} from "./lifecycle.ts";
import { SHAREABLE_FIELDS, type ShareableField } from "../contracts/crossProduct.ts";

export const MAX_ANALYSES_PER_GRANT = 50;

/** Consent receipt. Every field is evidence of what the client actually saw. */
export interface ConsentReceipt {
  readonly noticeVersion: string;
  readonly affirmedAt: string;
  /** The authenticated client who consented. Never the professional. */
  readonly affirmedByUserRef: string;
  readonly purpose: string;
  readonly selectedFields: readonly ShareableField[];
  readonly selectedAnalysisIds: readonly string[];
  readonly destinationRelationshipRef: string;
  readonly correlationId: string;
}

export interface ShareGrant {
  readonly shareGrantId: string;
  /** The confirmed cross-product link this grant rides on. */
  readonly crossProductLinkId: string;
  /** The client who owns the analyses and gave consent. */
  readonly clientUserRef: string;
  readonly destinationRelationshipRef: string;
  /** Which recipient context within that relationship may see it. */
  readonly recipientContext: string;
  readonly selectedAnalysisIds: readonly string[];
  readonly selectedFields: readonly ShareableField[];
  readonly purpose: string;
  readonly effectiveFrom: string;
  readonly expiresAt: string | null;
  readonly consent: ConsentReceipt;
  readonly correlationId: string;
  readonly lifecycle: LifecycleSnapshot<ShareGrantState>;
}

export type ShareCreationDenial =
  | "FEATURE_DISABLED"
  | "LINK_NOT_ACTIVE"
  | "NO_ANALYSES_SELECTED"
  | "TOO_MANY_ANALYSES"
  | "NO_FIELDS_SELECTED"
  | "UNKNOWN_FIELD"
  | "PURPOSE_REQUIRED"
  | "CONSENT_NOT_AFFIRMED"
  | "CONSENT_ACTOR_MISMATCH"
  | "NOTICE_VERSION_REQUIRED"
  | "EXPIRY_IN_PAST";

export type ShareCreationResult =
  | { readonly ok: true; readonly grant: ShareGrant }
  | { readonly ok: false; readonly reason: ShareCreationDenial };

export interface CreateShareGrantInput {
  readonly shareGrantId: string;
  readonly crossProductLinkId: string;
  readonly linkIsActive: boolean;
  readonly clientUserRef: string;
  /** The authenticated actor performing this. MUST be the client. */
  readonly authenticatedUserRef: string;
  readonly destinationRelationshipRef: string;
  readonly recipientContext: string;
  readonly selectedAnalysisIds: readonly string[];
  readonly selectedFields: readonly string[];
  readonly purpose: string;
  readonly expiresAt: string | null;
  readonly noticeVersion: string;
  readonly consentAffirmed: boolean;
  readonly now: Date;
  readonly correlationId: string;
  readonly isEnabled: boolean;
}

const SHAREABLE: ReadonlySet<string> = new Set(SHAREABLE_FIELDS);

export function createShareGrant(input: CreateShareGrantInput): ShareCreationResult {
  if (!input.isEnabled) return { ok: false, reason: "FEATURE_DISABLED" };

  // A grant rides on a confirmed, currently-active link.
  if (!input.linkIsActive) return { ok: false, reason: "LINK_NOT_ACTIVE" };

  // Only the client may consent to share their own analyses. A professional
  // cannot create a grant over someone else's data, whatever else they hold.
  if (input.authenticatedUserRef !== input.clientUserRef) {
    return { ok: false, reason: "CONSENT_ACTOR_MISMATCH" };
  }

  if (input.selectedAnalysisIds.length === 0) {
    return { ok: false, reason: "NO_ANALYSES_SELECTED" };
  }
  if (input.selectedAnalysisIds.length > MAX_ANALYSES_PER_GRANT) {
    return { ok: false, reason: "TOO_MANY_ANALYSES" };
  }
  if (input.selectedFields.length === 0) {
    return { ok: false, reason: "NO_FIELDS_SELECTED" };
  }
  for (const field of input.selectedFields) {
    if (!SHAREABLE.has(field)) return { ok: false, reason: "UNKNOWN_FIELD" };
  }
  if (!input.purpose || input.purpose.trim().length === 0) {
    return { ok: false, reason: "PURPOSE_REQUIRED" };
  }
  if (!input.noticeVersion) return { ok: false, reason: "NOTICE_VERSION_REQUIRED" };
  if (!input.consentAffirmed) return { ok: false, reason: "CONSENT_NOT_AFFIRMED" };
  if (input.expiresAt && new Date(input.expiresAt) <= input.now) {
    return { ok: false, reason: "EXPIRY_IN_PAST" };
  }

  const selectedFields = input.selectedFields as readonly ShareableField[];
  const nowIso = input.now.toISOString();

  return {
    ok: true,
    grant: {
      shareGrantId: input.shareGrantId,
      crossProductLinkId: input.crossProductLinkId,
      clientUserRef: input.clientUserRef,
      destinationRelationshipRef: input.destinationRelationshipRef,
      recipientContext: input.recipientContext,
      selectedAnalysisIds: [...input.selectedAnalysisIds],
      selectedFields: [...selectedFields],
      purpose: input.purpose,
      effectiveFrom: nowIso,
      expiresAt: input.expiresAt,
      consent: {
        noticeVersion: input.noticeVersion,
        affirmedAt: nowIso,
        affirmedByUserRef: input.clientUserRef,
        purpose: input.purpose,
        selectedFields: [...selectedFields],
        selectedAnalysisIds: [...input.selectedAnalysisIds],
        destinationRelationshipRef: input.destinationRelationshipRef,
        correlationId: input.correlationId,
      },
      correlationId: input.correlationId,
      lifecycle: {
        state: "active", version: 1,
        occurredAt: nowIso, appliedEventIds: [],
      },
    },
  };
}

/**
 * Projects an analysis into the shared summary, keeping ONLY selected fields.
 *
 * Whitelist copy: unknown/unselected keys are never read, so they cannot leak.
 */
export function projectSharedSummary(
  grant: ShareGrant,
  analysis: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const field of grant.selectedFields) {
    const value = analysis[field];
    if (typeof value === "string" && value.length > 0) {
      out[field] = value;
    }
  }
  return out;
}

/** True when the grant currently authorizes disclosure of this analysis. */
export function grantPermitsAnalysis(
  grant: ShareGrant,
  externalAnalysisId: string,
  now: Date,
): boolean {
  if (grant.lifecycle.state !== "active") return false;
  if (new Date(grant.effectiveFrom) > now) return false;
  if (grant.expiresAt && new Date(grant.expiresAt) <= now) return false;
  return grant.selectedAnalysisIds.includes(externalAnalysisId);
}

/**
 * Authorization for a professional read of a shared analysis.
 *
 * Rejects a grant addressed to a DIFFERENT relationship even when the analysis
 * ID matches — the "wrong-relationship callback fails" requirement.
 */
export function authorizeSharedRead(
  grant: ShareGrant,
  request: {
    readonly externalAnalysisId: string;
    readonly relationshipRef: string;
    readonly recipientContext: string;
  },
  now: Date,
): { readonly ok: boolean; readonly reason?: string } {
  if (grant.destinationRelationshipRef !== request.relationshipRef) {
    return { ok: false, reason: "WRONG_RELATIONSHIP" };
  }
  if (grant.recipientContext !== request.recipientContext) {
    return { ok: false, reason: "WRONG_RECIPIENT_CONTEXT" };
  }
  if (!grantPermitsAnalysis(grant, request.externalAnalysisId, now)) {
    return { ok: false, reason: "NOT_SHARED" };
  }
  return { ok: true };
}

export function applyShareGrantEvent(
  grant: ShareGrant,
  event: LifecycleEvent<ShareGrantState>,
) {
  return applyLifecycleEvent(SHARE_GRANT_LIFECYCLE, grant.lifecycle, event);
}

/**
 * Analysis deletion: one tombstone per grant that referenced it.
 * Returns the grants needing a tombstone event, per receiver prompt §14.
 */
export function tombstonesForDeletedAnalysis(
  grants: readonly ShareGrant[],
  externalAnalysisId: string,
): readonly string[] {
  return grants
    .filter(
      (g) =>
        g.selectedAnalysisIds.includes(externalAnalysisId) &&
        g.lifecycle.state === "active",
    )
    .map((g) => g.shareGrantId);
}
