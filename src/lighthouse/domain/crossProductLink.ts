/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 2 — cross-product identity linking.
 *
 * What a link IS: proof that the same human, authenticated separately in each
 * product, approved connecting two product-local identities.
 *
 * What a link IS NOT (receiver prompt §10, handoff gate):
 *   "An account link proves only that the same authenticated client approved
 *    linking the two product identities; it grants no professional visibility
 *    into the client's workspace."
 *
 * So a link confers NO analysis access, NO subscription, NO representation, NO
 * delegation and NO sharing. `LINK_GRANTS` below is empty, and a test asserts it
 * stays empty.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  LINK_LIFECYCLE, type LifecycleEvent, type LifecycleSnapshot, type LinkState,
  applyLifecycleEvent, initialSnapshot,
} from "./lifecycle.ts";

/**
 * The complete set of permissions a confirmed link grants. Deliberately empty.
 * If a future contract adds one, it must be added here AND the test that pins
 * this to zero entries must be consciously changed.
 */
export const LINK_GRANTS: readonly string[] = [];

export const DEFAULT_INVITATION_TTL_SECONDS = 900; // 15 minutes
export const MIN_INVITATION_TTL_SECONDS = 60;
export const MAX_INVITATION_TTL_SECONDS = 3600;

export interface LinkInvitation {
  readonly invitationId: string;
  /** SHA-256 of the challenge. The plaintext is never persisted. */
  readonly challengeHash: string;
  readonly relationshipOsPersonRef: string;
  readonly relationshipRef: string;
  readonly expiresAt: string;
  readonly noticeVersion: string;
  readonly correlationId: string;
  readonly consumedAt: string | null;
}

export interface CrossProductLink {
  readonly crossProductLinkId: string;
  readonly relationshipOsPersonRef: string;
  readonly investscapeUserRef: string;
  readonly relationshipRef: string;
  readonly noticeVersion: string;
  readonly acceptedAt: string;
  readonly correlationId: string;
  readonly lifecycle: LifecycleSnapshot<LinkState>;
}

/** Minimal record retained after unlink. Carries no personal data. */
export interface LinkTombstone {
  readonly crossProductLinkId: string;
  readonly tombstonedAt: string;
  readonly reason: "unlinked" | "revoked" | "expired";
  readonly correlationId: string;
}

export function hashChallenge(challenge: string): string {
  return createHash("sha256").update(challenge).digest("hex");
}

/** 256 bits, matching the launch-code strength the producer uses. */
export function generateChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export type AcceptanceDenial =
  | "INVITATION_NOT_FOUND"
  | "INVITATION_EXPIRED"
  | "INVITATION_ALREADY_CONSUMED"
  | "CHALLENGE_MISMATCH"
  | "INVESTSCAPE_USER_NOT_AUTHENTICATED"
  | "RELATIONSHIP_OS_PERSON_NOT_AUTHENTICATED"
  | "EMAIL_IS_NOT_IDENTITY"
  | "FEATURE_DISABLED";

export type AcceptanceResult =
  | { readonly ok: true; readonly link: CrossProductLink }
  | { readonly ok: false; readonly reason: AcceptanceDenial };

/**
 * Proof that each side authenticated its own user IN ITS OWN PRODUCT.
 *
 * Both fields are booleans set by each product's session layer. There is
 * deliberately no `email` field anywhere in this type — the "never link by
 * email" rule is enforced by the type system rather than by a validation branch
 * somebody could remove.
 */
export interface DualAuthenticationProof {
  readonly investscapeUserRef: string;
  readonly investscapeUserAuthenticated: boolean;
  readonly relationshipOsPersonRef: string;
  readonly relationshipOsPersonAuthenticated: boolean;
}

export interface AcceptInvitationInput {
  readonly invitation: LinkInvitation | null;
  /** Plaintext challenge presented by the accepting client. */
  readonly presentedChallenge: string;
  readonly proof: DualAuthenticationProof;
  readonly now: Date;
  readonly newLinkId: () => string;
  readonly correlationId: string;
  readonly isEnabled: boolean;
}

/**
 * Accepts a link invitation.
 *
 * Single-use is enforced by `consumedAt`; the caller must persist consumption
 * atomically (unique index on invitation_id where consumed_at is null) so two
 * concurrent acceptances cannot both succeed.
 */
export function acceptLinkInvitation(input: AcceptInvitationInput): AcceptanceResult {
  if (!input.isEnabled) return { ok: false, reason: "FEATURE_DISABLED" };

  const invitation = input.invitation;
  if (!invitation) return { ok: false, reason: "INVITATION_NOT_FOUND" };

  if (invitation.consumedAt !== null) {
    return { ok: false, reason: "INVITATION_ALREADY_CONSUMED" };
  }
  if (new Date(invitation.expiresAt) <= input.now) {
    return { ok: false, reason: "INVITATION_EXPIRED" };
  }

  // Timing-safe compare of the challenge hash.
  const presented = Buffer.from(hashChallenge(input.presentedChallenge), "hex");
  const expected = Buffer.from(invitation.challengeHash, "hex");
  if (
    presented.length !== expected.length ||
    !timingSafeEqual(presented, expected)
  ) {
    return { ok: false, reason: "CHALLENGE_MISMATCH" };
  }

  // DUAL authentication. Either side missing => refuse.
  if (!input.proof.investscapeUserAuthenticated) {
    return { ok: false, reason: "INVESTSCAPE_USER_NOT_AUTHENTICATED" };
  }
  if (!input.proof.relationshipOsPersonAuthenticated) {
    return { ok: false, reason: "RELATIONSHIP_OS_PERSON_NOT_AUTHENTICATED" };
  }

  // The authenticated Relationship OS person must be the one the invitation was
  // issued to. Otherwise an intercepted challenge could be redeemed by anyone.
  if (input.proof.relationshipOsPersonRef !== invitation.relationshipOsPersonRef) {
    return { ok: false, reason: "RELATIONSHIP_OS_PERSON_NOT_AUTHENTICATED" };
  }

  return {
    ok: true,
    link: {
      crossProductLinkId: input.newLinkId(),
      relationshipOsPersonRef: invitation.relationshipOsPersonRef,
      investscapeUserRef: input.proof.investscapeUserRef,
      relationshipRef: invitation.relationshipRef,
      noticeVersion: invitation.noticeVersion,
      acceptedAt: input.now.toISOString(),
      correlationId: input.correlationId,
      lifecycle: {
        ...initialSnapshot(LINK_LIFECYCLE, input.now.toISOString()),
        state: "active",
        version: 1,
      },
    },
  };
}

/**
 * Rejects any attempt to resolve a link from an email address.
 *
 * There is no code path that accepts an email; this exists so the prohibition is
 * executable and testable rather than merely documented.
 */
export function resolveLinkByEmail(_email: string): {
  readonly ok: false;
  readonly reason: "EMAIL_IS_NOT_IDENTITY";
} {
  return { ok: false, reason: "EMAIL_IS_NOT_IDENTITY" };
}

export function applyLinkEvent(
  link: CrossProductLink,
  event: LifecycleEvent<LinkState>,
) {
  return applyLifecycleEvent(LINK_LIFECYCLE, link.lifecycle, event);
}

/**
 * Unlink. Produces a tombstone and the set of share grants that must be revoked.
 *
 * Receiver prompt §14: "On unlink, revoke every active share unless the client
 * explicitly chooses an allowed retention exception."
 */
export function unlink(
  link: CrossProductLink,
  activeShareGrantIds: readonly string[],
  now: Date,
  reason: LinkTombstone["reason"] = "unlinked",
  retentionExceptions: readonly string[] = [],
): {
  readonly tombstone: LinkTombstone;
  readonly shareGrantsToRevoke: readonly string[];
} {
  const exceptions = new Set(retentionExceptions);
  return {
    tombstone: {
      crossProductLinkId: link.crossProductLinkId,
      tombstonedAt: now.toISOString(),
      reason,
      correlationId: link.correlationId,
    },
    shareGrantsToRevoke: activeShareGrantIds.filter((id) => !exceptions.has(id)),
  };
}
