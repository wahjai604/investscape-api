/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E85 — startup hook for the Vancouver spatial evidence.
 *
 * OFF unless E85_VANCOUVER_EVIDENCE_DIR is set. Nothing serves this evidence
 * yet, so an API deployed without the evidence folder must still start.
 *
 * ONCE SET, FAIL CLOSED: any verification failure throws out of startup and
 * the process does not listen. There is no "start degraded" branch — a zoning
 * subsystem that came up on unverified bytes would be indistinguishable, to
 * anything downstream, from one that came up on the pinned release.
 */

import { loadVancouverSpatialEvidence, type VancouverSpatialEvidence } from "./snapshotLoader.ts";

export const VANCOUVER_EVIDENCE_DIR_ENV = "E85_VANCOUVER_EVIDENCE_DIR";

export type VancouverSpatialBootStatus =
  | { readonly state: "disabled"; readonly reason: string }
  | { readonly state: "verified"; readonly evidence: VancouverSpatialEvidence; readonly heapUsedDeltaBytes: number };

export function bootstrapVancouverSpatialEvidence(env: NodeJS.ProcessEnv = process.env): VancouverSpatialBootStatus {
  const dir = env[VANCOUVER_EVIDENCE_DIR_ENV];
  if (dir === undefined || dir === "") return { state: "disabled", reason: `${VANCOUVER_EVIDENCE_DIR_ENV} not set` };
  const before = process.memoryUsage().heapUsed;
  const evidence = loadVancouverSpatialEvidence({ evidenceDir: dir });
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
