/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * ============================================================================
 * PROVISIONAL — NOT AGREED WITH RELATIONSHIP OS
 * ============================================================================
 * Every schema in this file is a PROPOSAL derived from the Relationship OS
 * scope documents. None has been reviewed or accepted by the Relationship OS
 * team, and no endpoint implementing them exists on either side.
 *
 * Exception: `lighthouse-product-entitlement.v1` is transcribed from a concrete
 * JSON example in UNIFIED_LIGHTHOUSE_SUITE_SUBSCRIPTION_SCOPE_V0.1 §"Control-
 * plane model", and `cross-product-admin-assignment.v1` from a concrete example
 * in CROSS_PRODUCT_ADMINISTRATION_HANDOFF_V0.1 §"Shared assignment contract".
 * Those two are transcriptions; the rest are inferences from prose.
 *
 * The handoff gate requires both teams to agree schemas BEFORE either side
 * implements live endpoints. Treat these as a starting point for that
 * conversation, not as a commitment.
 *
 * Design rules applied throughout:
 *   - opaque identifiers only; no email, no product-local primary keys
 *   - `.strict()` so an undeclared field is rejected, not absorbed
 *   - every event carries eventId (idempotency), version (monotonic ordering),
 *     occurredAt and correlationId
 *   - bounded string lengths and array sizes everywhere
 *   - NO billing, payment, plan, price or usage fields in anything that reaches
 *     Relationship OS or a professional
 */

import { z } from "zod";

const opaqueId = z.string().min(1).max(128);
const isoDateTime = z.string().datetime();
const boundedText = (max: number) => z.string().max(max);

/** Fields every cross-product event carries (invariant 5). */
const eventEnvelope = {
  eventId: opaqueId,
  /** Monotonic per aggregate. Consumers order by this, not by wall clock. */
  version: z.number().int().nonnegative(),
  occurredAt: isoDateTime,
  correlationId: opaqueId,
};

// ---------------------------------------------------------------------------
// Stage 2 — cross-product identity linking
// ---------------------------------------------------------------------------

export const LINK_STATES = ["pending", "active", "suspended", "revoked", "expired"] as const;

/**
 * `lighthouse.cross-product-link.invitation.v1`
 *
 * Relationship OS -> InvestScape. Creates a single-use, short-expiry challenge.
 *
 * Deliberately absent: email, name, phone, any profile field. Linking by email
 * equality is prohibited, so the schema simply cannot express it — the
 * prohibition is structural, not a runtime check that could be forgotten.
 */
export const crossProductLinkInvitationSchema = z
  .object({
    schemaVersion: z.literal("lighthouse.cross-product-link.invitation.v1"),
    ...eventEnvelope,
    /** Opaque invitation challenge. Single-use, short expiry. */
    invitationId: opaqueId,
    /** Opaque handle for the Relationship OS person. NOT their primary key. */
    relationshipOsPersonRef: opaqueId,
    /** The relationship this invitation is scoped to. */
    relationshipRef: opaqueId,
    expiresAt: isoDateTime,
    /** Version of the notice the person was shown (consent provenance). */
    noticeVersion: boundedText(32),
  })
  .strict();

export type CrossProductLinkInvitation = z.infer<typeof crossProductLinkInvitationSchema>;

/**
 * `lighthouse.cross-product-link.confirmed.v1`
 *
 * Sent only after BOTH products have independently authenticated their own
 * user. `investscapeUserRef` proves an InvestScape-authenticated acceptance;
 * `relationshipOsPersonRef` proves the Relationship OS side.
 */
export const crossProductLinkConfirmedSchema = z
  .object({
    schemaVersion: z.literal("lighthouse.cross-product-link.confirmed.v1"),
    ...eventEnvelope,
    invitationId: opaqueId,
    /** The opaque cross-product link identity. Neither side's primary key. */
    crossProductLinkId: opaqueId,
    relationshipOsPersonRef: opaqueId,
    investscapeUserRef: opaqueId,
    acceptedAt: isoDateTime,
    noticeVersion: boundedText(32),
  })
  .strict();

export type CrossProductLinkConfirmed = z.infer<typeof crossProductLinkConfirmedSchema>;

/**
 * `investscape.connection.changed.v1`
 *
 * InvestScape -> Relationship OS. Carries lifecycle state ONLY.
 * Note there is no field for plan, payment, analysis count or workspace
 * activity — Stage 3 forbids all of them.
 */
export const connectionChangedSchema = z
  .object({
    schemaVersion: z.literal("investscape.connection.changed.v1"),
    ...eventEnvelope,
    crossProductLinkId: opaqueId,
    state: z.enum(LINK_STATES),
  })
  .strict();

export type ConnectionChanged = z.infer<typeof connectionChangedSchema>;

// ---------------------------------------------------------------------------
// Stage 4 — client-selected sharing
// ---------------------------------------------------------------------------

/**
 * The display-safe fields a client may choose to share.
 * Matches the Stage 1 callback summary bounds so one analysis cannot disclose
 * more through the sharing path than through the sponsored path.
 */
export const SHAREABLE_FIELDS = [
  "status", "grade", "primaryOpportunity", "primaryRisk",
] as const;

export type ShareableField = (typeof SHAREABLE_FIELDS)[number];

export const sharedSummarySchema = z
  .object({
    status: boundedText(16).optional(),
    grade: boundedText(16).optional(),
    primaryOpportunity: boundedText(280).optional(),
    primaryRisk: boundedText(280).optional(),
  })
  .strict();

/**
 * `investscape.share-grant.changed.v1`
 *
 * ADDED 2026-09-02 per Relationship OS architecture review, P0:
 * "`investscape.analysis.shared.v1` contains only shareGrantId, analysis ID,
 * status, summary, and time. Relationship OS cannot independently verify the
 * destination relationship, recipient context, selected fields, purpose,
 * expiry, notice receipt, or current grant state unless a signed share-grant
 * projection already exists."
 *
 * This is that projection. `analysisSharedSchema` below now REQUIRES a
 * `grantVersion` referencing this record, so a summary can never arrive
 * without a way to check it was actually authorized at that version.
 *
 * `recipientOperatingContext` closes a related gap the review's P0 on
 * recipient context circles without naming directly: the notice a client
 * consented to differs materially depending on whether the professional was
 * acting `professional_assisted` or `delegated_client` at grant time, and
 * that distinction did not previously cross the wire at all.
 */
export const shareGrantChangedSchema = z
  .object({
    schemaVersion: z.literal("investscape.share-grant.changed.v1"),
    ...eventEnvelope,
    shareGrantId: opaqueId,
    crossProductLinkId: opaqueId,
    /** The Relationship OS relationship this grant is bound to. */
    relationshipRef: opaqueId,
    /** Which operating context governed this grant at the time it was made. */
    recipientOperatingContext: z.enum([
      "professional_assisted", "delegated_client",
    ]),
    purpose: boundedText(280),
    /** Field keys selected, drawn only from SHAREABLE_FIELDS. */
    allowedFieldKeys: z.array(z.enum(SHAREABLE_FIELDS)).max(SHAREABLE_FIELDS.length),
    effectiveFrom: isoDateTime,
    effectiveTo: isoDateTime.nullable(),
    noticeVersion: boundedText(32),
    /** Opaque reference to a stored consent receipt. Not the receipt itself. */
    consentReceiptRef: opaqueId,
    state: z.enum(["active", "expired", "revoked", "tombstoned"]),
    /** Monotonic per shareGrantId. An older version must never overwrite a newer one. */
    grantVersion: z.number().int().nonnegative(),
  })
  .strict();

export type ShareGrantChanged = z.infer<typeof shareGrantChangedSchema>;

/**
 * `investscape.analysis.shared.v1`
 *
 * REVISED 2026-09-02: `summary.status` removed (top-level `status` already
 * exists; the review calls the duplicate an unauthorized extra field), and
 * `grantVersion` added so a receiver can refuse a summary that does not match
 * a currently-active `shareGrantChangedSchema` record at that exact version.
 */
export const analysisSharedSchema = z
  .object({
    schemaVersion: z.literal("investscape.analysis.shared.v1"),
    ...eventEnvelope,
    shareGrantId: opaqueId,
    /** Must match a currently-active shareGrantChangedSchema.grantVersion. */
    grantVersion: z.number().int().nonnegative(),
    externalAnalysisId: opaqueId,
    status: z.enum(["draft", "complete", "failed"]),
    /** ONLY the fields the client explicitly selected. No `status` key here. */
    summary: sharedSummarySchema.omit({ status: true }),
    sharedAt: isoDateTime,
  })
  .strict();

export type AnalysisShared = z.infer<typeof analysisSharedSchema>;

/** `investscape.analysis.unshared.v1` */
export const analysisUnsharedSchema = z
  .object({
    schemaVersion: z.literal("investscape.analysis.unshared.v1"),
    ...eventEnvelope,
    shareGrantId: opaqueId,
    externalAnalysisId: opaqueId,
    revokedAt: isoDateTime,
  })
  .strict();

/** `investscape.share.revoked.v1` — the whole grant, not one analysis. */
export const shareRevokedSchema = z
  .object({
    schemaVersion: z.literal("investscape.share.revoked.v1"),
    ...eventEnvelope,
    shareGrantId: opaqueId,
    revokedAt: isoDateTime,
  })
  .strict();

/**
 * `investscape.analysis.tombstoned.v1`
 *
 * Emitted per active share when the underlying analysis is deleted. Carries no
 * summary: the point is removal, and re-sending content while announcing a
 * deletion would be self-defeating.
 */
export const analysisTombstonedSchema = z
  .object({
    schemaVersion: z.literal("investscape.analysis.tombstoned.v1"),
    ...eventEnvelope,
    shareGrantId: opaqueId,
    externalAnalysisId: opaqueId,
    tombstonedAt: isoDateTime,
    reason: z.enum(["analysis_deleted", "grant_revoked", "link_unlinked", "retention_expired"]),
  })
  .strict();

export type AnalysisTombstoned = z.infer<typeof analysisTombstonedSchema>;

// ---------------------------------------------------------------------------
// Lighthouse suite entitlement (transcribed from the scope document)
// ---------------------------------------------------------------------------

export const ENTITLEMENT_STATUSES = [
  "trialing", "active", "grace_period", "suspended",
  "cancelled_at_term_end", "expired", "revoked",
] as const;

/**
 * REVISED 2026-09-02 per architecture review ("wrong shape for approval"):
 *
 * 1. `subjectOrganizationId` prematurely assumed an organization subject.
 *    Per owner direction (2026-09-02): the suite follows the Office 365
 *    model — one Lighthouse login, independent PER-APP subscriptions, an
 *    individual may hold InvestScape alone. `subject` is now typed
 *    `individual | organization`, independent of who pays.
 * 2. `cancelled_at_term_end` is a billing/renewal INSTRUCTION, not an access
 *    state — the review is explicit that access must remain active until
 *    `effectiveTo`, then expire. `accessStatus` below is now separate from
 *    `renewalIntent`, so a consumer checking access never has to interpret
 *    a billing decision to know if the user can still use the product.
 */
export const ENTITLEMENT_ACCESS_STATUSES = [
  "trialing", "active", "grace_period", "suspended", "expired", "revoked",
] as const;

export const ENTITLEMENT_RENEWAL_INTENTS = ["renew", "cancel_at_term_end"] as const;

export const entitlementSubjectSchema = z
  .object({
    kind: z.enum(["individual", "organization"]),
    /** Opaque, product-local. Not the same ID space as productKey subjects. */
    subjectRef: opaqueId,
  })
  .strict();

export const productEntitlementSchema = z
  .object({
    schemaVersion: z.literal("lighthouse-product-entitlement.v2"),
    entitlementId: opaqueId,
    subscriptionId: opaqueId,
    subject: entitlementSubjectSchema,
    /** InvestScape rejects any projection not addressed to it. */
    productKey: z.literal("investscape"),
    packageKey: boundedText(64),
    /**
     * Feature keys not currently recognised by InvestScape MAY be stored for
     * diagnostics, but per the review "must never grant access" — enforcement
     * of that rule lives in the consumer (entitlementConsumer.ts), not here.
     */
    featureKeys: z.array(boundedText(64)).max(64),
    limits: z.record(z.string().max(64), z.number().int().nonnegative()).default({}),
    /** Whether the product may currently be used. Never inferred from renewalIntent. */
    accessStatus: z.enum(ENTITLEMENT_ACCESS_STATUSES),
    /** Billing/renewal instruction ONLY. Must not be read as an access state. */
    renewalIntent: z.enum(ENTITLEMENT_RENEWAL_INTENTS).default("renew"),
    issuedAt: isoDateTime,
    effectiveFrom: isoDateTime,
    effectiveTo: isoDateTime.nullable(),
    /** Monotonic. An older version must never overwrite a newer one. */
    version: z.number().int().nonnegative(),
    correlationId: opaqueId,
  })
  .strict();

export type ProductEntitlement = z.infer<typeof productEntitlementSchema>;

// ---------------------------------------------------------------------------
// Stage 7 — administration (transcribed from the handoff document)
// ---------------------------------------------------------------------------

/**
 * REVISED 2026-09-02 per architecture review: raw-looking shared
 * `subjectPersonId`/`grantedByPersonId`/`tenantId` conflicted with
 * product-local opaque identity boundaries. Renamed to `*Ref` and documented
 * as receiving-product-local references mapped through an approved link,
 * never a foreign primary key. Grantor detail narrowed to an opaque
 * authority reference; added eventId/version/occurredAt for idempotency and
 * ordering, consistent with every other cross-product event.
 */
export const adminAssignmentSchema = z
  .object({
    schemaVersion: z.literal("cross-product-admin-assignment.v2"),
    ...eventEnvelope,
    assignmentId: opaqueId,
    /** Receiving-product-local subject reference, not a foreign person ID. */
    subjectRef: opaqueId,
    productKey: z.enum(["relationship_os", "investscape"]),
    /** Receiving-product-local tenant reference. */
    tenantRef: opaqueId,
    scopes: z.array(boundedText(64)).max(32),
    status: z.enum(["active", "suspended", "revoked", "expired"]),
    effectiveFrom: isoDateTime,
    effectiveTo: isoDateTime.nullable(),
    /** Opaque reference into the issuing control plane. Not a raw person ID. */
    grantedByAuthorityRef: opaqueId,
    reasonCode: boundedText(64),
  })
  .strict();

export type AdminAssignment = z.infer<typeof adminAssignmentSchema>;

// ---------------------------------------------------------------------------
// Registry + dispatch
// ---------------------------------------------------------------------------

export const CROSS_PRODUCT_SCHEMAS = {
  "lighthouse.cross-product-link.invitation.v1": crossProductLinkInvitationSchema,
  "lighthouse.cross-product-link.confirmed.v1": crossProductLinkConfirmedSchema,
  "investscape.connection.changed.v1": connectionChangedSchema,
  "investscape.share-grant.changed.v1": shareGrantChangedSchema,
  "investscape.analysis.shared.v1": analysisSharedSchema,
  "investscape.analysis.unshared.v1": analysisUnsharedSchema,
  "investscape.share.revoked.v1": shareRevokedSchema,
  "investscape.analysis.tombstoned.v1": analysisTombstonedSchema,
  "lighthouse-product-entitlement.v2": productEntitlementSchema,
  "cross-product-admin-assignment.v2": adminAssignmentSchema,
} as const;

export type CrossProductSchemaVersion = keyof typeof CROSS_PRODUCT_SCHEMAS;

export type ValidationResult =
  | { readonly ok: true; readonly schemaVersion: CrossProductSchemaVersion; readonly value: unknown }
  | { readonly ok: false; readonly reason: "UNKNOWN_SCHEMA" | "INVALID_PAYLOAD"; readonly issues?: readonly string[] };

/**
 * Validates an inbound cross-product message by its declared schemaVersion.
 *
 * Invariant 8: an unknown schema version fails closed. It is NOT passed through,
 * NOT best-effort parsed, and NOT logged with its payload.
 */
export function validateCrossProductMessage(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }
  const declared = (input as { schemaVersion?: unknown }).schemaVersion;
  if (typeof declared !== "string" || !(declared in CROSS_PRODUCT_SCHEMAS)) {
    return { ok: false, reason: "UNKNOWN_SCHEMA" };
  }

  const version = declared as CrossProductSchemaVersion;
  const parsed = CROSS_PRODUCT_SCHEMAS[version].safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "INVALID_PAYLOAD",
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "<root>"}: ${issue.code}`,
      ),
    };
  }
  return { ok: true, schemaVersion: version, value: parsed.data };
}

/**
 * Field names that must NEVER appear in anything crossing to Relationship OS or
 * a professional. Used as a belt-and-braces assertion in tests; `.strict()`
 * schemas are the actual enforcement.
 */
export const FORBIDDEN_CROSS_PRODUCT_FIELDS = [
  "planName", "plan", "price", "amount", "currencyAmount", "paymentStatus",
  "paymentState", "renewalDate", "failedPayments", "invoice", "invoiceId",
  "usage", "portfolioSize", "analysisCount", "unsharedAnalysisCount",
  "workspaceActivity", "lastLoginAt", "email", "emailAddress", "phone",
  "passwordHash", "supabaseToken", "accessToken", "refreshToken",
  "paymentMethodId", "stripeCustomerId", "cardLast4", "taxId",
] as const;
