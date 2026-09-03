/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Server-owned feature flags for the Relationship OS ↔ InvestScape integration.
 *
 * Contract rules these implement (STAGES_2_TO_8 prompt, "Required feature flags"):
 *   - Every flag defaults to DISABLED. Absence of configuration is "off", never "on".
 *   - Flags are server-owned. Nothing here reads a request, header, cookie, or
 *     browser-supplied value. A hidden button is not a security control.
 *   - A flag NEVER bypasses authorization. Enabling a flag only makes a fully
 *     authorized flow reachable; the authorization check still runs and still
 *     fails closed. See `domain/policy.ts` for the guard that enforces this.
 *   - Unknown flag keys fail closed (invariant 8).
 */

/**
 * The complete set of known flags. Anything outside this list is unknown and
 * resolves to `false` — a typo disables a feature rather than silently
 * enabling one.
 */
export const LIGHTHOUSE_FEATURE_FLAGS = [
  /** Stage 1: the secure launch receiver, redemption, and result callback. */
  "lighthouse.stage1_launch_receiver",
  /** Stage 2: cross-product identity linking. */
  "lighthouse.cross_product_identity_linking",
  /** Stage 3: coarse client-workspace availability disclosure. */
  "lighthouse.client_workspace_disclosure",
  /** Stage 4: client-selected analysis sharing. */
  "lighthouse.selected_analysis_sharing",
  /** Stage 5: professional connectivity projection. */
  "lighthouse.professional_connectivity_projection",
  /** Stage 6: cross-product lifecycle/outbox synchronization. */
  "lighthouse.lifecycle_synchronization",
  /** Stage 7: cross-product administration surfaces. */
  "lighthouse.cross_product_administration",
  /** Stage 8: delegated client portfolio management (Mode D). */
  "lighthouse.delegated_portfolio_management",
  /** Stage 8 extension: assisted consent. Blocked on legal/compliance sign-off. */
  "lighthouse.assisted_consent",
  /** Lighthouse suite entitlement synchronization. */
  "lighthouse.suite_entitlement_sync",
] as const;

export type LighthouseFeatureFlag = (typeof LIGHTHOUSE_FEATURE_FLAGS)[number];

const KNOWN_FLAGS: ReadonlySet<string> = new Set(LIGHTHOUSE_FEATURE_FLAGS);

/**
 * `lighthouse.selected_analysis_sharing` -> `LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING`
 */
export function envVarNameFor(flag: LighthouseFeatureFlag): string {
  return `LIGHTHOUSE_FF_${flag.replace(/^lighthouse\./, "").toUpperCase()}`;
}

export interface FeatureFlagSource {
  readonly [key: string]: string | undefined;
}

/**
 * Resolves a flag from a server-side environment source.
 *
 * Only the exact string "true" (trimmed, case-insensitive) enables a flag.
 * "1", "yes", "on", "TRUE " with padding, and every other value are treated as
 * disabled — we would rather ignore a sloppy enable than guess one into
 * existence.
 */
export function isFeatureEnabled(
  flag: string,
  source: FeatureFlagSource = process.env,
): boolean {
  // Invariant 8: unknown feature keys fail closed.
  if (!KNOWN_FLAGS.has(flag)) return false;

  const raw = source[envVarNameFor(flag as LighthouseFeatureFlag)];
  if (typeof raw !== "string") return false;

  return raw.trim().toLowerCase() === "true";
}

/** Snapshot of every known flag. Useful for admin/health surfaces and tests. */
export function featureFlagSnapshot(
  source: FeatureFlagSource = process.env,
): Record<LighthouseFeatureFlag, boolean> {
  const out = {} as Record<LighthouseFeatureFlag, boolean>;
  for (const flag of LIGHTHOUSE_FEATURE_FLAGS) {
    out[flag] = isFeatureEnabled(flag, source);
  }
  return out;
}

/** True when a flag name is one this build knows about. */
export function isKnownFeatureFlag(flag: string): flag is LighthouseFeatureFlag {
  return KNOWN_FLAGS.has(flag);
}
