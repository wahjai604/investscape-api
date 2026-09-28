/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E85 — fail-closed verification of the Vancouver legal pack (R1-1 + C-2C).
 *
 * Two checks, both throwing `VancouverLegalPackEvidenceError`:
 *
 *   1. `hashVancouverLegalPackPdfs` hashes the schedule PDFs in the evidence
 *      folder and requires each to equal this API's pin. A missing file is a
 *      failure, never a skip. The digests it returns are what the engine's
 *      `assembleVancouverLegalPackForServer` takes as observed bytes.
 *   2. `verifyEngineLegalPackManifest` compares an engine legal-pack manifest
 *      with the same pins: source identity, version, adapter, PDF digest and
 *      fact-set digest. It also refuses a manifest that claims release or
 *      AS_OF resolution, so a re-vendored engine cannot flip this API's
 *      posture without an edit here.
 *
 * Passing both proves binding only. The returned posture is still
 * PACKAGED_NOT_RELEASED and serves no decision: a pack whose values match the
 * PDFs is not thereby public-ready.
 *
 * The engine manifest is taken structurally, because the vendored engine
 * (0.3.0) ships no E85 code; nothing here imports engine test fixtures.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { VANCOUVER_LEGAL_PACK, type VancouverLegalPack } from "./legalPack.ts";

export type VancouverLegalPackFailureCode = "PDF_MISSING" | "PDF_HASH_MISMATCH" | "IDENTITY_MISMATCH" | "FACT_SET_MISMATCH" | "UNEXPECTED_RELEASE_CLAIM";

export class VancouverLegalPackEvidenceError extends Error {
  readonly problems: readonly { readonly code: VancouverLegalPackFailureCode; readonly message: string }[];
  constructor(problems: readonly { code: VancouverLegalPackFailureCode; message: string }[]) {
    super(`Vancouver legal pack failed verification:\n- ${problems.map((p) => `[${p.code}] ${p.message}`).join("\n- ")}`);
    this.name = "VancouverLegalPackEvidenceError";
    this.problems = [...problems];
  }
}

/** The fields of the engine's `E85LegalPackManifest` this API checks. */
export interface EngineLegalPackManifestLike {
  readonly legalPackId: string;
  readonly jurisdictionId: string;
  readonly releaseStatus: string;
  readonly asOfResolution: string;
  readonly sources: readonly {
    readonly zoneDesignation: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly sourcePdfSha256: string;
    readonly adapterId: string;
    readonly adapterVersion: string;
    readonly factIds: readonly string[];
    readonly factSetSha256: string;
  }[];
}

export interface VancouverLegalPackPosture {
  readonly legalPackId: string;
  readonly status: "PACKAGED_NOT_RELEASED";
  readonly releaseStatus: "NOT_RELEASED";
  readonly asOfResolution: "DISABLED";
  readonly servesDecisions: false;
  readonly publicReady: false;
}

const posture = (pack: VancouverLegalPack): VancouverLegalPackPosture => ({
  legalPackId: pack.legalPackId,
  status: pack.readiness.status,
  releaseStatus: pack.readiness.releaseStatus,
  asOfResolution: pack.readiness.asOfResolution,
  servesDecisions: pack.readiness.servesDecisions,
  publicReady: false,
});

/** sourceId -> SHA-256 of the PDF bytes on disk. Throws on any missing or mismatched file. */
export function hashVancouverLegalPackPdfs(evidenceDir: string, pack: VancouverLegalPack = VANCOUVER_LEGAL_PACK): ReadonlyMap<string, string> {
  const problems: { code: VancouverLegalPackFailureCode; message: string }[] = [];
  const observed = new Map<string, string>();
  for (const s of pack.sources) {
    const file = path.join(evidenceDir, s.evidencePath);
    if (!existsSync(file)) {
      problems.push({ code: "PDF_MISSING", message: `${s.zone}: ${s.evidencePath} not found under the evidence folder` });
      continue;
    }
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (digest !== s.pdfSha256) problems.push({ code: "PDF_HASH_MISMATCH", message: `${s.zone}: ${s.evidencePath} is ${digest}, pinned ${s.pdfSha256}` });
    else observed.set(s.sourceId, digest);
  }
  if (problems.length > 0) throw new VancouverLegalPackEvidenceError(problems);
  return observed;
}

/** Requires an engine manifest to match this API's pins exactly. Returns the unchanged, non-serving posture. */
export function verifyEngineLegalPackManifest(manifest: EngineLegalPackManifestLike, pack: VancouverLegalPack = VANCOUVER_LEGAL_PACK): VancouverLegalPackPosture {
  const problems: { code: VancouverLegalPackFailureCode; message: string }[] = [];
  if (manifest.releaseStatus !== "NOT_RELEASED") problems.push({ code: "UNEXPECTED_RELEASE_CLAIM", message: `engine manifest releaseStatus is ${manifest.releaseStatus}; this API only accepts NOT_RELEASED until it is changed on purpose` });
  if (manifest.asOfResolution !== "DISABLED") problems.push({ code: "UNEXPECTED_RELEASE_CLAIM", message: `engine manifest asOfResolution is ${manifest.asOfResolution}; this API only accepts DISABLED` });
  if (manifest.legalPackId !== pack.legalPackId || manifest.jurisdictionId !== pack.jurisdictionId) problems.push({ code: "IDENTITY_MISMATCH", message: `engine pack ${manifest.legalPackId}/${manifest.jurisdictionId} is not ${pack.legalPackId}/${pack.jurisdictionId}` });
  if (manifest.sources.length !== pack.sources.length) problems.push({ code: "IDENTITY_MISMATCH", message: `engine pack has ${manifest.sources.length} sources, pinned ${pack.sources.length}` });
  for (const pin of pack.sources) {
    const s = manifest.sources.find((x) => x.sourceId === pin.sourceId);
    if (s === undefined) {
      problems.push({ code: "IDENTITY_MISMATCH", message: `${pin.zone}: ${pin.sourceId} missing from the engine pack` });
      continue;
    }
    const identity: [string, string, string][] = [
      ["zone", s.zoneDesignation, pin.zone],
      ["sourceVersionId", s.sourceVersionId, pin.sourceVersionId],
      ["adapterId", s.adapterId, pin.adapterId],
      ["adapterVersion", s.adapterVersion, pin.adapterVersion],
      ["sourcePdfSha256", s.sourcePdfSha256, pin.pdfSha256],
    ];
    for (const [name, got, want] of identity) if (got !== want) problems.push({ code: "IDENTITY_MISMATCH", message: `${pin.zone}: ${name} ${got}, pinned ${want}` });
    if (s.factSetSha256 !== pin.factSetSha256) problems.push({ code: "FACT_SET_MISMATCH", message: `${pin.zone}: fact set ${s.factSetSha256}, pinned ${pin.factSetSha256}` });
    if (s.factIds.length !== pin.structuredFactCount) problems.push({ code: "FACT_SET_MISMATCH", message: `${pin.zone}: ${s.factIds.length} facts, pinned ${pin.structuredFactCount}` });
  }
  if (problems.length > 0) throw new VancouverLegalPackEvidenceError(problems);
  return posture(pack);
}
