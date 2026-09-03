/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Lighthouse suite entitlement CONSUMER.
 *
 * InvestScape consumes signed product-local entitlement projections. It does not
 * originate them, and it never accepts one asserted by a browser.
 *
 * UNIFIED_LIGHTHOUSE_SUITE_SUBSCRIPTION_SCOPE_V0.1 §"InvestScape handoff
 * classification" is explicit that a Claude implementation prompt "should be
 * produced only after the open catalogue, payer, allowance, lifecycle, and
 * billing-provider decisions are approved" — 11 decisions, none made. So this
 * file deliberately implements ONLY the consumer interface, persistence shape,
 * lifecycle handling and a DISABLED synchronization adapter. There is no
 * checkout, no billing control plane, and no payment code.
 *
 * The commercial rule with teeth (§"Professional-sponsored and delegated use"):
 *   "A professional paying for a delegated portfolio does not become the
 *    client-data owner and does not automatically receive access."
 * `entitlementGrantsPortfolioAuthority` returns false, always.
 */

import {
  ENTITLEMENT_LIFECYCLE, type EntitlementState, type LifecycleEvent,
  type LifecycleSnapshot, applyLifecycleEvent,
} from "../domain/lifecycle.ts";
import {
  type ProductEntitlement, productEntitlementSchema,
} from "../contracts/crossProduct.ts";

/** Feature keys InvestScape understands. Unknown keys fail closed. */
export const KNOWN_FEATURE_KEYS = [
  "investscape_workspace",
  "deal_analyzer",
  "development_studio",
  "market_intelligence",
  "portfolio_analytics",
  "tax_engine",
  "sponsored_analysis",
  "delegated_portfolios",
] as const;

export type KnownFeatureKey = (typeof KNOWN_FEATURE_KEYS)[number];
const KNOWN_FEATURES: ReadonlySet<string> = new Set(KNOWN_FEATURE_KEYS);

/** Numeric allowances InvestScape understands. */
export const KNOWN_LIMIT_KEYS = [
  "professionalSeats", "staffSeats", "delegatedPortfolios",
  "sponsoredAnalyses", "storageMb",
] as const;

export interface StoredEntitlement {
  readonly entitlementId: string;
  readonly subscriptionId: string;
  readonly subject: { readonly kind: "individual" | "organization"; readonly subjectRef: string };
  readonly packageKey: string;
  readonly featureKeys: readonly KnownFeatureKey[];
  /** Feature keys we did not recognise. Retained for support, never granted. */
  readonly unknownFeatureKeys: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  /** Billing/renewal instruction ONLY. Never read for access decisions. */
  readonly renewalIntent: "renew" | "cancel_at_term_end";
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly correlationId: string;
  readonly lifecycle: LifecycleSnapshot<EntitlementState>;
}

export type EntitlementRejection =
  | "UNKNOWN_SCHEMA"
  | "INVALID_PAYLOAD"
  | "WRONG_PRODUCT"
  | "WRONG_SUBJECT"
  | "SIGNATURE_INVALID"
  | "STALE_VERSION"
  | "FEATURE_DISABLED";

export type EntitlementIngestResult =
  | { readonly ok: true; readonly entitlement: StoredEntitlement; readonly changed: boolean }
  | { readonly ok: false; readonly reason: EntitlementRejection };

export interface IngestInput {
  /** Raw projection, already signature-verified by the transport layer. */
  readonly payload: unknown;
  /** Result of HMAC verification. False => reject regardless of content. */
  readonly signatureValid: boolean;
  /** The subject (individual or organization) this InvestScape instance is resolving for. */
  readonly expectedSubject: { readonly kind: "individual" | "organization"; readonly subjectRef: string };
  readonly existing: StoredEntitlement | null;
  readonly now: Date;
  readonly isEnabled: boolean;
}

/**
 * Ingests an entitlement projection.
 *
 * Order: flag -> signature -> schema -> product -> subject -> monotonic version.
 * Every check fails closed, and a stale version is refused so a replayed old
 * "active" cannot reactivate a cancelled subscription.
 */
export function ingestEntitlementProjection(
  input: IngestInput,
): EntitlementIngestResult {
  if (!input.isEnabled) return { ok: false, reason: "FEATURE_DISABLED" };
  if (!input.signatureValid) return { ok: false, reason: "SIGNATURE_INVALID" };

  if (typeof input.payload !== "object" || input.payload === null) {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }
  const declared = (input.payload as { schemaVersion?: unknown }).schemaVersion;
  if (declared !== "lighthouse-product-entitlement.v2") {
    return { ok: false, reason: "UNKNOWN_SCHEMA" };
  }

  const parsed = productEntitlementSchema.safeParse(input.payload);
  if (!parsed.success) {
    // A projection addressed to another product fails the productKey literal.
    const wrongProduct = parsed.error.issues.some((i) => i.path[0] === "productKey");
    return { ok: false, reason: wrongProduct ? "WRONG_PRODUCT" : "INVALID_PAYLOAD" };
  }
  const projection: ProductEntitlement = parsed.data;

  if (
    projection.subject.kind !== input.expectedSubject.kind ||
    projection.subject.subjectRef !== input.expectedSubject.subjectRef
  ) {
    return { ok: false, reason: "WRONG_SUBJECT" };
  }

  // Monotonic version. An equal version is an idempotent replay, not a change.
  if (input.existing) {
    if (projection.version < input.existing.lifecycle.version) {
      return { ok: false, reason: "STALE_VERSION" };
    }
    if (projection.version === input.existing.lifecycle.version) {
      return { ok: true, entitlement: input.existing, changed: false };
    }
  }

  const known: KnownFeatureKey[] = [];
  const unknown: string[] = [];
  for (const key of projection.featureKeys) {
    if (KNOWN_FEATURES.has(key)) known.push(key as KnownFeatureKey);
    else unknown.push(key);
  }

  const previous = input.existing?.lifecycle ?? {
    state: "trialing" as EntitlementState,
    version: 0,
    occurredAt: input.now.toISOString(),
    appliedEventIds: [] as readonly string[],
  };

  const event: LifecycleEvent<EntitlementState> = {
    eventId: `${projection.subscriptionId}:${projection.version}`,
    // Access state ONLY. `renewalIntent` is a billing instruction and never
    // drives this transition, per the review's correction: cancellation at
    // term end must not truncate access early.
    targetState: projection.accessStatus,
    version: projection.version,
    occurredAt: input.now.toISOString(),
    correlationId: projection.correlationId,
  };

  const outcome = applyLifecycleEvent(ENTITLEMENT_LIFECYCLE, previous, event);
  const lifecycle = outcome.kind === "applied" ? outcome.snapshot : previous;

  if (outcome.kind === "rejected" || outcome.kind === "stale") {
    return { ok: false, reason: "STALE_VERSION" };
  }

  return {
    ok: true,
    changed: outcome.kind === "applied",
    entitlement: {
      entitlementId: projection.entitlementId,
      subscriptionId: projection.subscriptionId,
      subject: projection.subject,
      packageKey: projection.packageKey,
      featureKeys: known,
      unknownFeatureKeys: unknown,
      limits: projection.limits,
      renewalIntent: projection.renewalIntent,
      effectiveFrom: projection.effectiveFrom,
      effectiveTo: projection.effectiveTo,
      correlationId: projection.correlationId,
      lifecycle,
    },
  };
}

/**
 * States in which paid features remain usable.
 *
 * REVISED 2026-09-02: `cancelled_at_term_end` removed from this list because
 * it no longer exists as an access state at all — it was a billing intent
 * masquerading as one. A "cancel at term end" projection now arrives as
 * `accessStatus: "active"` with `renewalIntent: "cancel_at_term_end"`, so
 * access is governed purely by `accessStatus` + `effectiveTo`, exactly as the
 * review required: "retain active access until effectiveTo, then expire."
 */
const USABLE_STATES: ReadonlySet<EntitlementState> = new Set<EntitlementState>([
  "trialing", "active", "grace_period",
]);

export function entitlementIsUsable(
  entitlement: StoredEntitlement | null,
  now: Date,
): boolean {
  if (!entitlement) return false;
  if (!USABLE_STATES.has(entitlement.lifecycle.state)) return false;
  if (new Date(entitlement.effectiveFrom) > now) return false;
  if (entitlement.effectiveTo && new Date(entitlement.effectiveTo) <= now) return false;
  return true;
}

/** Feature gate. Unknown keys fail closed even if present in the projection. */
export function hasFeature(
  entitlement: StoredEntitlement | null,
  feature: string,
  now: Date,
): boolean {
  if (!KNOWN_FEATURES.has(feature)) return false;
  if (!entitlementIsUsable(entitlement, now)) return false;
  return entitlement!.featureKeys.includes(feature as KnownFeatureKey);
}

export function limitFor(
  entitlement: StoredEntitlement | null,
  key: string,
  now: Date,
): number {
  if (!entitlementIsUsable(entitlement, now)) return 0;
  const value = entitlement!.limits[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Suppresses a second checkout when a suite entitlement is already active.
 *
 * §"Unified customer UI": "InvestScape should recognize the suite entitlement
 * and avoid asking the professional to subscribe again. If an included
 * entitlement is missing or stale, show a neutral synchronization/support state
 * rather than a second checkout."
 */
export type CheckoutPrompt =
  | { readonly kind: "none"; readonly reason: "entitled" }
  | { readonly kind: "synchronizing"; readonly reason: "stale_or_missing_projection" }
  | { readonly kind: "offer_checkout" };

export function resolveCheckoutPrompt(
  entitlement: StoredEntitlement | null,
  now: Date,
  syncEnabled: boolean,
): CheckoutPrompt {
  if (entitlementIsUsable(entitlement, now)) {
    return { kind: "none", reason: "entitled" };
  }
  // Sync is on but we hold nothing usable: the projection may simply be late.
  // Never dump the user into a duplicate purchase because of a race.
  if (syncEnabled && entitlement === null) {
    return { kind: "synchronizing", reason: "stale_or_missing_projection" };
  }
  if (entitlement && entitlement.lifecycle.state === "suspended") {
    return { kind: "synchronizing", reason: "stale_or_missing_projection" };
  }
  return { kind: "offer_checkout" };
}

/**
 * Invariant 4, made executable.
 *
 * Paying for something never grants authority over another person's portfolio.
 * Always false, by design, with no parameters that could change the answer.
 */
export function entitlementGrantsPortfolioAuthority(): false {
  return false;
}

/**
 * Fields that must never appear in an entitlement projection reaching
 * InvestScape, and never cross to a professional or Relationship OS.
 */
export const FORBIDDEN_ENTITLEMENT_FIELDS = [
  "planName", "price", "amount", "currency", "paymentMethod", "cardLast4",
  "invoiceId", "invoiceUrl", "renewalDate", "failedPaymentCount",
  "stripeCustomerId", "taxAmount", "billingEmail", "billingAddress",
] as const;

/**
 * DISABLED synchronization adapter.
 *
 * There is no Lighthouse commercial control plane yet. This returns a disabled
 * result rather than reaching for a URL that does not exist — the same
 * fail-closed posture as Stage 1's `exchangeLaunchCode`.
 */
export interface EntitlementSyncAdapter {
  fetchProjection(subjectOrganizationId: string): Promise<
    | { readonly kind: "disabled" }
    | { readonly kind: "projection"; readonly payload: unknown; readonly signatureValid: boolean }
  >;
}

export class DisabledEntitlementSyncAdapter implements EntitlementSyncAdapter {
  async fetchProjection(
    _subjectOrganizationId: string,
  ): Promise<{ readonly kind: "disabled" }> {
    return { kind: "disabled" };
  }
}
