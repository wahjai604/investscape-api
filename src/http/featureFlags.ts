/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Server-owned feature flags for the CORE HTTP surface — the stateless
 * calculation-engine routes mounted at /v1 (61 reachable endpoints; see
 * `engineGuards.ts` for why that is not the "~76" quoted elsewhere).
 *
 * This is a deliberate SIBLING of `lighthouse/config/featureFlags.ts`, not a
 * replacement for it and not a caller of it. Same rules, different registry:
 *
 *   - Every flag defaults to DISABLED. Absence of configuration is "off",
 *     never "on".
 *   - Only the exact string "true" (trimmed, case-insensitive) enables a flag.
 *     "1", "yes", "on" and everything else are treated as DISABLED on purpose —
 *     we would rather ignore a sloppy enable than guess one into existence.
 *   - Flags are server-owned. Nothing here reads a request, header, cookie or
 *     any browser-supplied value.
 *   - Unknown flag keys fail closed.
 *   - A flag NEVER bypasses authorization. The one flag below can only make an
 *     existing authorization check MANDATORY; there is deliberately no flag in
 *     this file, and there must never be one, whose effect is to skip a check.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE REGISTRY RATHER THAN ADDING TO LIGHTHOUSE_FEATURE_FLAGS
 * ---------------------------------------------------------------------------
 * Three reasons, in order of weight:
 *
 *   1. Ownership. `LIGHTHOUSE_FEATURE_FLAGS` is the agreed contract set for the
 *      Relationship OS <-> InvestScape integration (STAGES_2_TO_8). This flag
 *      governs the calculation API, which exists independently of that
 *      integration and would still exist if it were deleted.
 *   2. Honesty of the startup log. `bootstrap.ts` reports
 *      `status.enabledFlags` as "the Lighthouse flags that are on". Smuggling a
 *      core-API flag into that list would make that line say something untrue.
 *   3. Env prefix. `LIGHTHOUSE_FF_*` reads as "part of the integration". A
 *      reviewer scanning the deployment env should be able to tell from the
 *      name alone which subsystem a variable arms.
 *
 * The ~4 lines of duplicated parsing below are the price, and they are the
 * cheaper side of the trade — the alternative is the core API's security
 * posture importing from a subsystem that is allowed to be absent (see
 * `bootstrap.ts`, which degrades to a 503-only router). `http/rateLimit.ts`
 * makes the same call for the same reason ("this module stays standalone").
 * The parsing rule is pinned by test in both places precisely because it is
 * stated twice.
 */

/**
 * The complete set of known core-API flags. Anything outside this list is
 * unknown and resolves to `false` — a typo disables a feature rather than
 * silently enabling one.
 */
export const INVESTSCAPE_FEATURE_FLAGS = [
  /**
   * Require a verified session on the /v1 calculation-engine routes.
   *
   * WHY THIS EXISTS: server-authoritative entitlement gating (Free / Pro /
   * Enterprise) is structurally impossible on an endpoint that does not know
   * who is calling. Tier limits enforced only in the browser are not limits.
   * So the engines have to learn to require identity eventually.
   *
   * WHY IT IS OFF: nothing consumes this API with a session today. The HTML
   * prototype sends no Authorization header, and there is no token-issuing
   * client. Turning this on now would take the calculators down for every
   * existing caller in exchange for a gate nothing is yet ready to pass.
   *
   * Blocked on: a client that authenticates (Supabase session in the front
   * end), and the entitlement/tier model that this gate is the precondition
   * for. Enabling it without both is a self-inflicted outage.
   */
  "investscape.require_engine_auth",
] as const;

export type InvestscapeFeatureFlag = (typeof INVESTSCAPE_FEATURE_FLAGS)[number];

const KNOWN_FLAGS: ReadonlySet<string> = new Set(INVESTSCAPE_FEATURE_FLAGS);

/**
 * `investscape.require_engine_auth` -> `INVESTSCAPE_FF_REQUIRE_ENGINE_AUTH`
 */
export function envVarNameFor(flag: InvestscapeFeatureFlag): string {
  return `INVESTSCAPE_FF_${flag.replace(/^investscape\./, "").toUpperCase()}`;
}

export interface FeatureFlagSource {
  readonly [key: string]: string | undefined;
}

/**
 * Resolves a core-API flag from a server-side environment source.
 *
 * Only the exact string "true" enables. See the module comment for why the
 * permissive spellings are rejected rather than accommodated.
 */
export function isCoreFeatureEnabled(
  flag: string,
  source: FeatureFlagSource = process.env,
): boolean {
  // Unknown feature keys fail closed, same rule as the Lighthouse registry.
  if (!KNOWN_FLAGS.has(flag)) return false;

  const raw = source[envVarNameFor(flag as InvestscapeFeatureFlag)];
  if (typeof raw !== "string") return false;

  return raw.trim().toLowerCase() === "true";
}

/** True when a flag name is one this build knows about. */
export function isKnownCoreFeatureFlag(flag: string): flag is InvestscapeFeatureFlag {
  return KNOWN_FLAGS.has(flag);
}
