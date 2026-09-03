/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 1 wire contracts.
 *
 * Two schemas cross the boundary:
 *   investscape-launch-context.v1    Relationship OS -> InvestScape (redemption response)
 *   investscape-result-reference.v1  InvestScape -> Relationship OS (callback)
 *
 * Both are `.strict()`. PRIVACY_SECURITY_AND_INTERAPP_GOVERNANCE_V0.1 requires
 * that "InvestScape must reject undeclared fields and may not expand scope
 * locally" — a permissive parse would silently accept a field Relationship OS
 * later adds, and we would start depending on data nobody agreed to send.
 *
 * CONFIRMED 2026-09-01. The launch-context shape was originally inferred from
 * CLAUDE_INVESTSCAPE_RECEIVER_IMPLEMENTATION_PROMPT_V0.2 §2-3 prose, then
 * verified field by field against the producer implementation
 * (`packages/analysis-gateway/gatewayService.ts`) and its contract suite
 * (`tests/investscape-redemption-v0.2.test.mjs`) on branch
 * `origin/feature/investscape-launch-v0.1`.
 *
 * One real mismatch was found and fixed: the property address field is
 * `address`, not `formattedAddress`. See `launchPropertySchema` below.
 *
 * Still worth a human confirmation from the Relationship OS team, since we are
 * reading an unmerged feature branch — but this is no longer guesswork.
 */

import { z } from "zod";

/**
 * UUID SHAPE, not strict RFC 9562.
 *
 * Zod v4's `.uuid()` validates the version and variant nibbles. The Relationship
 * OS test fixture `11111111-2222-3333-4444-555555555555` fails that check — its
 * variant nibble is `4`, not 8/9/a/b. Their production IDs come from Postgres
 * `gen_random_uuid()` and are v4-compliant, so strict validation would pass in
 * production while rejecting every fixture they publish, which makes
 * cross-product contract testing impossible.
 *
 * We therefore validate the SHAPE (8-4-4-4-12 hex). These identifiers are opaque
 * transport keys looked up server-side; we derive no meaning from their bits, so
 * variant strictness buys nothing and costs interoperability.
 */
const uuidShape = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, {
    message: "invalid_uuid_shape",
  });

export const LAUNCH_CONTEXT_SCHEMA_VERSION = "investscape-launch-context.v1";
export const RESULT_REFERENCE_SCHEMA_VERSION = "investscape-result-reference.v1";

/** The only analysis type the v0.1/v0.2 gateway issues. */
export const ANALYSIS_TYPES = ["investment_quick_review"] as const;

/**
 * Modules InvestScape is willing to open.
 *
 * Mirrors ROS_LAUNCH.KNOWN_MODULES in investscape-v2-remastered.html so the
 * browser scaffold and the server agree. Anything outside this list is dropped
 * fail-closed AND counted, so an unexpected module surfaces as a security alert
 * rather than a silent no-op (receiver prompt §7).
 */
export const KNOWN_MODULES = ["property_overview", "financial_summary"] as const;

export type KnownModule = (typeof KNOWN_MODULES)[number];

const knownModuleSet: ReadonlySet<string> = new Set(KNOWN_MODULES);

export function isKnownModule(value: string): value is KnownModule {
  return knownModuleSet.has(value);
}

/**
 * Splits server-returned modules into permitted and rejected.
 * Never throws: an unknown module is a fail-closed drop plus an alert, not a
 * reason to deny an otherwise valid session.
 */
export function partitionModules(modules: readonly string[]): {
  readonly permitted: readonly KnownModule[];
  readonly rejected: readonly string[];
} {
  const permitted: KnownModule[] = [];
  const rejected: string[] = [];
  for (const module of modules) {
    if (isKnownModule(module)) permitted.push(module);
    else rejected.push(module);
  }
  return { permitted, rejected };
}

// --- investscape-launch-context.v1 ------------------------------------------

/**
 * The property projection.
 *
 * CONFIRMED 2026-09-01 against the producer implementation
 * (`packages/analysis-gateway/gatewayService.ts` on
 * `origin/feature/investscape-launch-v0.1`), which builds it as:
 *
 *   propertyRef  = sha256(`${session.id}:${property.id}`).hex   // 64 hex chars
 *   propertyType = properties.property_type                     // non-null
 *   jurisdiction = jurisdictions.name                           // e.g. "British Columbia"
 *   address      = [line1,line2,city,subdivision,postal_code,country_code]
 *                    .filter(Boolean).join(', ')
 *   listPrice    = Number(listings.list_price)   // only when non-null
 *   currency     = listings.currency             // only when non-null
 *
 * ⚠️ The field is `address`, NOT `formattedAddress`. Receiver prompt §3 says
 * "formatted address" in prose, which I originally read as a field name. Because
 * this schema is `.strict()`, that mistake would have rejected EVERY successful
 * redemption in production. Caught by reading the producer source rather than
 * its documentation. Same lesson as the header-name defect.
 *
 * `propertyType`, `jurisdiction` and `address` are non-nullable in the producer,
 * but stay `.optional()` here: accepting an absent field is harmless, whereas
 * demanding one they later drop is another hard failure.
 */
export const launchPropertySchema = z
  .object({
    propertyRef: z.string().min(1).max(128),
    propertyType: z.string().min(1).max(64).optional(),
    jurisdiction: z.string().min(1).max(128).optional(),
    address: z.string().min(1).max(512).optional(),
    listPrice: z.number().finite().nonnegative().optional(),
    // ISO 4217 is 3 characters, but this comes from a free-text listings column.
    // Bounded rather than pinned — an over-tight guess here fails the same way
    // `formattedAddress` did.
    currency: z.string().min(1).max(8).optional(),
  })
  .strict();

export const launchContextSchema = z
  .object({
    schemaVersion: z.literal(LAUNCH_CONTEXT_SCHEMA_VERSION),
    launchSessionId: uuidShape,
    analysisType: z.enum(ANALYSIS_TYPES),
    modules: z.array(z.string().min(1).max(64)).max(32),
    permittedScopes: z.array(z.string().min(1).max(64)).max(32),
    redactedScopes: z.array(z.string().min(1).max(64)).max(32).default([]),
    expiresAt: z.string().datetime(),
    context: z.object({ property: launchPropertySchema }).strict(),
    correlationId: z.string().min(1).max(128),
  })
  .strict();

export type LaunchContext = z.infer<typeof launchContextSchema>;

/**
 * Scope -> field allow-list, enforced HERE rather than trusted from the wire.
 *
 * CONFIRMED DEFECT 2026-09-02 (Relationship OS architecture review, P0): the
 * producer's redemption response includes `listPrice`/`currency` whenever the
 * underlying row has them, WITHOUT conditioning on `permittedScopes` or
 * `redactedScopes`. `redactedScopes` is attached to the same payload as
 * decoration, not enforcement — so a field the response itself labels
 * redacted can still be present.
 *
 * We cannot fix the producer. We CAN refuse to trust it: redeem the response
 * ourselves against a local scope->field map, and drop (fail closed) any
 * field whose governing scope is not in `permittedScopes`, or IS in
 * `redactedScopes`. An unrecognised scope grants nothing.
 *
 * This map only needs to describe fields InvestScape actually reads.
 * `propertyRef`, `propertyType`, `jurisdiction` are treated as always
 * permitted structural identifiers (they carry no financial disclosure by
 * themselves); `listPrice`/`currency`/`address` are gated.
 */
export const PROPERTY_FIELD_SCOPES: Readonly<Record<string, string>> = {
  address: "property.address",
  listPrice: "finance.summary",
  currency: "finance.summary",
};

/**
 * Applies the scope allow-list to a validated launch context, returning a new
 * context with any unpermitted or redacted field removed from
 * `context.property`. Never throws; an over-broad producer response degrades
 * to a narrower one rather than failing the whole redemption.
 */
export function enforceScopeRedaction(context: LaunchContext): {
  readonly context: LaunchContext;
  readonly droppedFields: readonly string[];
} {
  const permitted = new Set(context.permittedScopes);
  const redacted = new Set(context.redactedScopes);
  const property = { ...context.context.property } as Record<string, unknown>;
  const dropped: string[] = [];

  for (const [field, scope] of Object.entries(PROPERTY_FIELD_SCOPES)) {
    if (!(field in property)) continue;
    const isPermitted = permitted.has(scope) && !redacted.has(scope);
    if (!isPermitted) {
      delete property[field];
      dropped.push(field);
    }
  }

  return {
    context: { ...context, context: { property: property as LaunchContext["context"]["property"] } },
    droppedFields: dropped,
  };
}

// --- investscape-result-reference.v1 ----------------------------------------

/**
 * Callback lifecycle. `draft` on first save, then exactly one terminal state.
 * Receiver prompt §6: "Never change a terminal complete/failed status."
 */
export const RESULT_STATUSES = ["draft", "complete", "failed"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const TERMINAL_RESULT_STATUSES: ReadonlySet<ResultStatus> = new Set([
  "complete",
  "failed",
]);

/**
 * The ONLY permitted summary keys, with the exact bounds from receiver prompt
 * §6. `.strict()` means a worksheet, raw input, prompt or model trace cannot be
 * smuggled through an extra key — it fails validation before transmission.
 */
export const resultSummarySchema = z
  .object({
    grade: z.string().max(16).optional(),
    primaryOpportunity: z.string().max(280).optional(),
    primaryRisk: z.string().max(280).optional(),
  })
  .strict();

export type ResultSummary = z.infer<typeof resultSummarySchema>;

/**
 * Bounds CONFIRMED 2026-09-01 against the producer's own validators in
 * `gatewayService.handleAnalysisReference`:
 *   externalAnalysisId  boundedString(v, 1, 160)
 *   correlationId       optionalBoundedString(v, 160)
 * Originally 128 here, which would have made us reject our own valid IDs before
 * ever sending them. Aligned to 160.
 */
export const resultReferenceSchema = z
  .object({
    schemaVersion: z.literal(RESULT_REFERENCE_SCHEMA_VERSION),
    launchSessionId: uuidShape,
    externalAnalysisId: z.string().min(1).max(160),
    analysisType: z.enum(ANALYSIS_TYPES),
    status: z.enum(RESULT_STATUSES),
    summary: resultSummarySchema.optional(),
    completedAt: z.string().datetime().optional(),
    correlationId: z.string().min(1).max(160).optional(),
  })
  .strict();

export type ResultReference = z.infer<typeof resultReferenceSchema>;

/**
 * `investscape-result-reference-ack.v1` — the 200 body Relationship OS returns
 * when it accepts a callback.
 *
 * CONFIRMED against `gatewayService.ts`. Receiver prompt §6 says to "persist the
 * returned analysisReferenceId and acceptedAt for reconciliation" but never
 * names the schema, so this was missing until the producer source was read.
 *
 * Parsed leniently (`.passthrough()` semantics via optional fields) rather than
 * strictly: an unrecognised field in THEIR acknowledgement is their business,
 * and rejecting it would strand a callback they have already accepted.
 */
export const resultReferenceAckSchema = z.object({
  schemaVersion: z.literal("investscape-result-reference-ack.v1").optional(),
  analysisReferenceId: z.string().min(1).max(160),
  externalAnalysisId: z.string().min(1).max(160).optional(),
  status: z.enum(RESULT_STATUSES).optional(),
  acceptedAt: z.string().min(1).max(64).optional(),
});

export type ResultReferenceAck = z.infer<typeof resultReferenceAckSchema>;

export function parseResultReferenceAck(input: unknown): ParseResult<ResultReferenceAck> {
  return toParseResult(resultReferenceAckSchema.safeParse(input));
}

/**
 * The producer's 409 reason codes, all from `classifyCallbackFailure`.
 * Every one is terminal for a given payload — retrying identical bytes cannot
 * change the outcome, so none of these consume retry budget.
 */
export const CALLBACK_CONFLICT_CODES = [
  /** Callback arrived before the launch session was redeemed. Ordering bug. */
  "LAUNCH_SESSION_NOT_CONSUMED",
  /** This externalAnalysisId is already bound to a different launch session. */
  "ANALYSIS_REFERENCE_CONTEXT_CONFLICT",
  /** Attempted to move away from an existing terminal status. */
  "CALLBACK_STATUS_REGRESSION",
  /** Same status, different summary/completedAt — not an identical retry. */
  "ANALYSIS_REFERENCE_PAYLOAD_CONFLICT",
  /** Catch-all. */
  "ANALYSIS_REFERENCE_CONFLICT",
] as const;

/**
 * Monotonic status transitions.
 *
 * draft -> complete | failed | draft(identical retry)
 * complete/failed   -> itself only (identical retry)
 *
 * Relationship OS rejects regression with 409; we must not emit one in the
 * first place.
 */
export function isPermittedResultTransition(
  from: ResultStatus | null,
  to: ResultStatus,
): boolean {
  if (from === null) return true;
  if (from === to) return true;
  if (TERMINAL_RESULT_STATUSES.has(from)) return false;
  return from === "draft" && TERMINAL_RESULT_STATUSES.has(to);
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

type SafeParseLike<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly issues: readonly z.core.$ZodIssue[] } };

function toParseResult<T>(parsed: SafeParseLike<T>): ParseResult<T> {
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    // Paths and codes only. Zod echoes received values in some messages and we
    // must not let a one-time code reach a log through a validation error.
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.code}`,
    ),
  };
}

export function parseLaunchContext(input: unknown): ParseResult<LaunchContext> {
  return toParseResult(launchContextSchema.safeParse(input));
}

export function parseResultReference(input: unknown): ParseResult<ResultReference> {
  return toParseResult(resultReferenceSchema.safeParse(input));
}

/**
 * Builds a callback payload, discarding anything not explicitly selected.
 *
 * Takes an unknown summary and keeps ONLY the three permitted keys. This is the
 * "unselected fields are discarded" guarantee implemented as a whitelist copy
 * rather than a delete-list, so a new internal analysis field can never leak by
 * default.
 */
export function buildResultReference(input: {
  readonly launchSessionId: string;
  readonly externalAnalysisId: string;
  readonly status: ResultStatus;
  readonly summary?: Readonly<Record<string, unknown>>;
  readonly completedAt?: string;
  readonly correlationId?: string;
}): ParseResult<ResultReference> {
  const summary: Record<string, unknown> = {};
  if (input.summary) {
    if (typeof input.summary.grade === "string") summary.grade = input.summary.grade;
    if (typeof input.summary.primaryOpportunity === "string") {
      summary.primaryOpportunity = input.summary.primaryOpportunity;
    }
    if (typeof input.summary.primaryRisk === "string") {
      summary.primaryRisk = input.summary.primaryRisk;
    }
  }

  return parseResultReference({
    schemaVersion: RESULT_REFERENCE_SCHEMA_VERSION,
    launchSessionId: input.launchSessionId,
    externalAnalysisId: input.externalAnalysisId,
    analysisType: "investment_quick_review",
    status: input.status,
    ...(Object.keys(summary).length > 0 ? { summary } : {}),
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  });
}
