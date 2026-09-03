/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Operating context: WHOSE portfolio the authenticated user is acting on.
 *
 * This is deliberately independent from product entitlement. Per
 * UNIFIED_LIGHTHOUSE_SUITE_SUBSCRIPTION_SCOPE_V0.1 §"Unified customer UI":
 *   "An active InvestScape entitlement answers which InvestScape features the
 *    person may use; it does not answer whether the person is acting for
 *    themselves, working within a bounded Relationship OS-assisted analysis, or
 *    managing a delegated client portfolio."
 *
 * Invariant 1: the browser NEVER establishes the operating context. A request
 * may *request* a context; only the server resolves one, and only by finding a
 * current authority record. Occupation, subscription tier, URL, a remembered
 * selector, or a client label are never inputs. See `resolveOperatingContext`.
 */

import type { AuditAuthority } from "../audit/auditEvent.ts";

export const OPERATING_CONTEXT_KINDS = [
  /** The authenticated user acts for themselves and is the portfolio subject. */
  "personal",
  /** A bounded Stage 1 analysis launched from an authorized Relationship OS relationship. */
  "professional_assisted",
  /** An authenticated professional acting for a client under a current mandate. */
  "delegated_client",
  /** RESERVED. Disabled until an organization-owned portfolio contract is approved. */
  "organization",
] as const;

export type OperatingContextKind = (typeof OPERATING_CONTEXT_KINDS)[number];

const KNOWN_KINDS: ReadonlySet<string> = new Set(OPERATING_CONTEXT_KINDS);

/**
 * `organization` is modelled so that data and events can be represented, but it
 * must never resolve successfully until the contract exists. Listing it here
 * rather than omitting it keeps the state machine total.
 */
export const DISABLED_CONTEXT_KINDS: ReadonlySet<OperatingContextKind> = new Set([
  "organization",
]);

export function isKnownOperatingContext(value: string): value is OperatingContextKind {
  return KNOWN_KINDS.has(value);
}

/**
 * A context the server has resolved and vouches for.
 *
 * There is intentionally no constructor that accepts a raw browser value; the
 * only way to obtain one is `resolveOperatingContext`, which requires an
 * authority record.
 */
export interface ResolvedOperatingContext {
  readonly kind: OperatingContextKind;
  /** The authenticated actor performing the request. */
  readonly actorId: string;
  /** Whose data this is. Equals actorId only for `personal`. */
  readonly subjectId: string;
  /** The authority that justified this context. */
  readonly authority: AuditAuthority;
  /** Permitted scopes within this context. Empty means nothing is permitted. */
  readonly scopes: readonly string[];
  /** Set for professional_assisted and delegated_client. */
  readonly relationshipRef?: string;
  /** Set for delegated_client: when the mandate stops being valid. */
  readonly expiresAt?: string;
  readonly correlationId: string;
}

export type ContextDenialReason =
  | "UNKNOWN_CONTEXT"
  | "CONTEXT_DISABLED"
  | "NO_AUTHORITY"
  | "AUTHORITY_NOT_ACTIVE"
  | "AUTHORITY_EXPIRED"
  | "SUBJECT_MISMATCH"
  | "FEATURE_DISABLED"
  /** delegated_client requires requestedRelationshipRef; ambiguous without one. */
  | "RELATIONSHIP_REF_REQUIRED";

export type ContextResolution =
  | { readonly ok: true; readonly context: ResolvedOperatingContext }
  | { readonly ok: false; readonly reason: ContextDenialReason };

/**
 * A current, server-held authority record. Supplied by a repository lookup —
 * never by the caller's request body.
 */
export interface ContextAuthorityRecord {
  readonly kind: OperatingContextKind;
  readonly actorId: string;
  readonly subjectId: string;
  readonly authority: AuditAuthority;
  readonly scopes: readonly string[];
  readonly status: "active" | "suspended" | "expired" | "revoked";
  readonly relationshipRef?: string;
  readonly effectiveFrom?: string;
  readonly expiresAt?: string;
}

export interface ResolveContextInput {
  /** Proven by the session layer, not by the payload. */
  readonly authenticatedActorId: string;
  /** What the browser ASKED for. A hint only; never trusted as authority. */
  readonly requestedKind: string;
  /**
   * Which relationship to act under. A hint only, like `requestedKind` — it
   * selects among the actor's OWN authority records; it can never substitute
   * for one.
   *
   * REQUIRED for `delegated_client`. A professional can hold many concurrent
   * client mandates; a bare `(actorId, "delegated_client")` lookup was
   * previously ambiguous — it had no way to know which client to resolve.
   * See 2026-09-02 finding: "professional working with multiple clients on
   * InvestScape... could have their own investment portfolio on top of
   * managing their client's portfolio."
   */
  readonly requestedRelationshipRef?: string;
  /** Looks up a current authority record for this actor + kind (+ relationship for delegated_client). */
  readonly lookupAuthority: (
    actorId: string,
    kind: OperatingContextKind,
    relationshipRef?: string,
  ) => Promise<ContextAuthorityRecord | null>;
  readonly isContextEnabled: (kind: OperatingContextKind) => boolean;
  readonly now: () => Date;
  readonly correlationId: string;
}

/**
 * The single approved way to obtain a `ResolvedOperatingContext`.
 *
 * Fails closed at every branch. Note `personal` still requires an authority
 * record — the trivial self-authority — so that "acting for yourself" is an
 * explicit, auditable decision rather than an implicit default.
 */
export async function resolveOperatingContext(
  input: ResolveContextInput,
): Promise<ContextResolution> {
  // Invariant 8: unknown context values fail closed.
  if (!isKnownOperatingContext(input.requestedKind)) {
    return { ok: false, reason: "UNKNOWN_CONTEXT" };
  }
  const kind = input.requestedKind;

  if (DISABLED_CONTEXT_KINDS.has(kind)) {
    return { ok: false, reason: "CONTEXT_DISABLED" };
  }
  if (!input.isContextEnabled(kind)) {
    return { ok: false, reason: "FEATURE_DISABLED" };
  }

  // A professional may hold many concurrent delegated_client mandates.
  // Resolving "delegated_client" without saying which client is ambiguous;
  // refuse rather than silently pick one. professional_assisted does not
  // need this because its relationship is already fixed by the Stage 1
  // launch session that created it.
  if (kind === "delegated_client" && !input.requestedRelationshipRef) {
    return { ok: false, reason: "RELATIONSHIP_REF_REQUIRED" };
  }

  const record = await input.lookupAuthority(
    input.authenticatedActorId,
    kind,
    input.requestedRelationshipRef,
  );
  if (!record) {
    return { ok: false, reason: "NO_AUTHORITY" };
  }

  // The record must belong to the authenticated actor. Guards against a lookup
  // that keys off a browser-supplied identifier by mistake.
  if (record.actorId !== input.authenticatedActorId) {
    return { ok: false, reason: "SUBJECT_MISMATCH" };
  }

  // Defence in depth: even if lookupAuthority ignored the selector, refuse a
  // record for the wrong relationship rather than trust it silently.
  if (
    kind === "delegated_client" &&
    input.requestedRelationshipRef !== undefined &&
    record.relationshipRef !== input.requestedRelationshipRef
  ) {
    return { ok: false, reason: "SUBJECT_MISMATCH" };
  }
  if (record.status !== "active") {
    return { ok: false, reason: "AUTHORITY_NOT_ACTIVE" };
  }

  const now = input.now();
  if (record.effectiveFrom && new Date(record.effectiveFrom) > now) {
    return { ok: false, reason: "AUTHORITY_NOT_ACTIVE" };
  }
  if (record.expiresAt && new Date(record.expiresAt) <= now) {
    return { ok: false, reason: "AUTHORITY_EXPIRED" };
  }

  // For personal work the actor must be the subject. Anything else means the
  // record is mis-shaped and we refuse rather than guess.
  if (kind === "personal" && record.subjectId !== record.actorId) {
    return { ok: false, reason: "SUBJECT_MISMATCH" };
  }

  return {
    ok: true,
    context: {
      kind,
      actorId: record.actorId,
      subjectId: record.subjectId,
      authority: record.authority,
      scopes: record.scopes,
      relationshipRef: record.relationshipRef,
      expiresAt: record.expiresAt,
      correlationId: input.correlationId,
    },
  };
}

/**
 * Cache/state partition key.
 *
 * DELEGATED_CLIENT scope doc: "Reports, exports, uploads, recent items, search,
 * notifications, browser history, cached state and AI context must all remain
 * partitioned by workspace context." Every cache, search index, recents list and
 * AI context window must be keyed by this, so a personal result can never be
 * served inside a delegated context or vice versa.
 */
export function contextPartitionKey(context: ResolvedOperatingContext): string {
  return [
    context.kind,
    context.actorId,
    context.subjectId,
    context.relationshipRef ?? "-",
  ].join("|");
}

/** True when two contexts may share cached state. Conservative by design. */
export function sharesPartition(
  a: ResolvedOperatingContext,
  b: ResolvedOperatingContext,
): boolean {
  return contextPartitionKey(a) === contextPartitionKey(b);
}

/**
 * Transient state that must be cleared when switching context, before the
 * destination is authorized. Named here so the frontend shell and the server
 * agree on one list.
 */
export const TRANSIENT_STATE_KEYS = [
  "draftAnalysis",
  "uploadQueue",
  "recentItems",
  "searchResults",
  "aiConversationContext",
  "reportBuilderState",
  "scenarioComparison",
  "notificationBadges",
] as const;
