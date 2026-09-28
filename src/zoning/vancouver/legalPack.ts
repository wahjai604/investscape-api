/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E85 — the identity of the Vancouver legal pack (R1-1 + C-2C) that a spatial
 * normalization is keyed against, and its production-readiness state.
 *
 * WHAT THIS IS: identity only — which source documents, at which consolidation,
 * pinned by the SHA-256 of the exact PDF bytes the facts were extracted from.
 * It is what the snapshot cache is keyed on, so a Phase 8 normalization linked
 * against one legal pack can never be served for another.
 *
 * WHAT THIS IS NOT: the facts themselves. The engine now packages the R1-1
 * and C-2C facts as a production legal pack
 * (`adapters.vancouver.legalPack`, manifest `e85-legal-pack-1`) bound to
 * these PDF digests by `factSetSha256`, but the engine version vendored into
 * this API (0.3.0) ships no E85 code at all, so nothing here can load it.
 * The pins below mirror the engine manifest so that, once re-vendored, a
 * changed fact set or PDF fails boot until it is re-pinned here on purpose
 * (see legalPackVerifier.ts). Packaging is not release: see `readiness`.
 */

import { createHash } from "node:crypto";

export const VANCOUVER_LEGAL_PACK = {
  legalPackId: "ca-bc-vancouver.base-zoning.r1-1+c-2c",
  jurisdictionId: "ca-bc-vancouver",
  sources: [
    {
      zone: "R1-1",
      sourceId: "ca-bc-vancouver:zoning-development-bylaw-3575:district-schedule-r1-1",
      adapterId: "ca-bc-vancouver.district-schedule.r1-1",
      adapterVersion: "1.1.0",
      sourceVersionId: "2026-06-consolidation",
      evidencePath: "vancouver/zoning-by-law-district-schedule-r1-1.pdf",
      pdfSha256: "2526db0b7a7df787222348a43011ad64d1c52d4699c218f287aaa346cc38d514",
      structuredFactCount: 19,
      factSetSha256: "0fee9c560a27a3c4037c6f036fba2f62805d4eb97713d10ab094be5756d3de93",
    },
    {
      zone: "C-2C",
      sourceId: "ca-bc-vancouver:zoning-development-bylaw-3575:district-schedule-c-2c",
      adapterId: "ca-bc-vancouver.district-schedule.c-2c",
      adapterVersion: "1.1.0",
      sourceVersionId: "2026-05-consolidation",
      evidencePath: "vancouver-c2c/acquired-sources/zoning-by-law-district-schedule-c-2c.pdf",
      pdfSha256: "4fe8197ec979b347210f195bbeacaa1dd98153e84ea69f90ecf52321b0db621a",
      structuredFactCount: 7,
      factSetSha256: "5a187daa95a253370a6e848e9a6752585e0f87f5d8550f20a116e92f6722cd76",
    },
  ],
  readiness: {
    /**
     * PACKAGED_NOT_RELEASED: the values were checked against rendered pages of
     * the pinned PDFs (2026-09-26) and the engine now binds them to those
     * bytes, but the pack is NOT_RELEASED with AS_OF resolution DISABLED, its
     * licence, version validity, definition history and amendment currency
     * are unknown, and the Schedule J rate is withheld. Matching bytes never
     * change this; only a deliberate edit here can.
     */
    status: "PACKAGED_NOT_RELEASED",
    releaseStatus: "NOT_RELEASED",
    asOfResolution: "DISABLED",
    servesDecisions: false,
  },
} as const;

export type VancouverLegalPack = typeof VANCOUVER_LEGAL_PACK;

/** Canonical identity: pack id + each source's adapter, version and PDF hash. Readiness is deliberately excluded — it describes the pack, it does not identify it. */
export function legalPackDigest(pack: VancouverLegalPack = VANCOUVER_LEGAL_PACK): string {
  const identity = {
    legalPackId: pack.legalPackId,
    sources: pack.sources.map((s) => [s.zone, s.adapterId, s.adapterVersion, s.sourceVersionId, s.pdfSha256, s.factSetSha256]),
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
