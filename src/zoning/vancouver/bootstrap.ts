/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E85 — startup hook for the Vancouver spatial evidence.
 *
 * OFF UNLESS EXPLICITLY ENABLED. Two variables, read once at startup:
 *
 *   E85_VANCOUVER_SPATIAL_ENABLED   the switch. Only the exact value "true"
 *                                   enables. Unset, "" or "false" disables.
 *                                   Any other value is refused at startup.
 *   E85_VANCOUVER_EVIDENCE_DIR      the e85-pilot-evidence folder. Read ONLY
 *                                   when the switch is "true". Otherwise it is
 *                                   ignored, so a stale path left in a
 *                                   deployment cannot stop the server.
 *
 * Nothing serves this evidence yet, so an API deployed without the switch must
 * start normally.
 *
 * ONCE ENABLED, FAIL CLOSED: a blank path, or any verification failure, throws
 * out of startup before `app.listen`, and the process does not listen. There
 * is no "start degraded" branch. A zoning subsystem that came up on unverified
 * bytes would look the same, to anything downstream, as one that came up on
 * the pinned release.
 */

import { loadVancouverSpatialEvidence, type VancouverSpatialEvidence } from "./snapshotLoader.ts";

export const VANCOUVER_SPATIAL_ENABLED_ENV = "E85_VANCOUVER_SPATIAL_ENABLED";
export const VANCOUVER_EVIDENCE_DIR_ENV = "E85_VANCOUVER_EVIDENCE_DIR";

/** A startup configuration error: the switch is malformed, or it is on without a usable path. */
export class VancouverSpatialBootConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VancouverSpatialBootConfigError";
  }
}

export type VancouverSpatialBootStatus =
  | { readonly state: "disabled"; readonly reason: string }
  | { readonly state: "verified"; readonly evidence: VancouverSpatialEvidence; readonly heapUsedDeltaBytes: number };

/** The loader, injectable so the switch logic can be tested without the evidence folder. */
export type VancouverSpatialLoader = (options: { readonly evidenceDir: string }) => VancouverSpatialEvidence;

export function bootstrapVancouverSpatialEvidence(
  env: NodeJS.ProcessEnv = process.env,
  load: VancouverSpatialLoader = loadVancouverSpatialEvidence,
): VancouverSpatialBootStatus {
  const flag = env[VANCOUVER_SPATIAL_ENABLED_ENV];
  if (flag === undefined || flag === "" || flag === "false") {
    const ignored = env[VANCOUVER_EVIDENCE_DIR_ENV] ? `; ${VANCOUVER_EVIDENCE_DIR_ENV} is set but ignored` : "";
    return { state: "disabled", reason: `${VANCOUVER_SPATIAL_ENABLED_ENV} is not "true"${ignored}` };
  }
  if (flag !== "true") {
    throw new VancouverSpatialBootConfigError(`${VANCOUVER_SPATIAL_ENABLED_ENV} must be "true" or "false" (or unset), got ${JSON.stringify(flag)}`);
  }
  const dir = env[VANCOUVER_EVIDENCE_DIR_ENV];
  if (dir === undefined || dir.trim() === "") {
    throw new VancouverSpatialBootConfigError(`${VANCOUVER_SPATIAL_ENABLED_ENV} is "true" but ${VANCOUVER_EVIDENCE_DIR_ENV} is blank; set it to the evidence folder or disable the switch`);
  }
  const before = process.memoryUsage().heapUsed;
  const evidence = load({ evidenceDir: dir });
  return { state: "verified", evidence, heapUsedDeltaBytes: process.memoryUsage().heapUsed - before };
}

/** One line for the boot log. States identity and posture, never a decision. */
export function describeVancouverSpatialBoot(s: VancouverSpatialBootStatus): string {
  if (s.state === "disabled") return `🗺️  e85 vancouver spatial: disabled (${s.reason}) · no zoning route mounted`;
  const e = s.evidence;
  return (
    `🗺️  e85 vancouver spatial: verified ${e.manifest.dataset.datasetId}@${e.manifest.release.releaseId} ` +
    `sha256=${e.manifest.bytes.sha256.slice(0, 12)}… features=${e.summary.featureCount} ` +
    `legal=${e.legalPack.legalPackId} (${e.legalPack.readiness.status}) · ${e.timings.totalMs.toFixed(0)} ms · ` +
    `no zoning route mounted, PID lookup unavailable`
  );
}
