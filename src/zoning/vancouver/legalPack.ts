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
 * WHAT THIS IS NOT: the facts themselves. The structured R1-1 and C-2C facts
 * currently exist only as engine test fixtures
 * (`__tests__/zoning-land-use-engine/fixtures/vancouver-{r1-1,c-2c}-facts.ts`),
 * and the engine version vendored into this API (0.3.0) ships no E85 code at
 * all. Moving those fixtures to a production path would not make them
 * production evidence, so they are not copied here. See `readiness` below and
 * `e85-pilot-evidence/VANCOUVER-LEGAL-PACK-AUDIT.md` for the audit.
 */

import { createHash } from "node:crypto";

export const VANCOUVER_LEGAL_PACK = {
  legalPackId: "ca-bc-vancouver.base-zoning.r1-1+c-2c",
  jurisdictionId: "ca-bc-vancouver",
  sources: [
    {
      zone: "R1-1",
      adapterId: "ca-bc-vancouver.district-schedule.r1-1",
      adapterVersion: "1.0.0",
      sourceVersionId: "2026-06-consolidation",
      evidencePath: "vancouver/zoning-by-law-district-schedule-r1-1.pdf",
      pdfSha256: "2526db0b7a7df787222348a43011ad64d1c52d4699c218f287aaa346cc38d514",
      structuredFactCount: 19,
    },
    {
      zone: "C-2C",
      adapterId: "ca-bc-vancouver.district-schedule.c-2c",
      adapterVersion: "1.0.0",
      sourceVersionId: "2026-05-consolidation",
      evidencePath: "vancouver-c2c/acquired-sources/zoning-by-law-district-schedule-c-2c.pdf",
      pdfSha256: "4fe8197ec979b347210f195bbeacaa1dd98153e84ea69f90ecf52321b0db621a",
      structuredFactCount: 7,
    },
  ],
  readiness: {
    /**
     * VALUES_AUDITED_NOT_PACKAGED: every structured value was checked against
     * rendered pages of the pinned PDFs (2026-09-26) and matched, but the facts
     * are not yet production artefacts — they live under the engine's
     * __tests__, the engine source definitions do not bind to the PDF hashes,
     * and no API build contains them.
     */
    status: "VALUES_AUDITED_NOT_PACKAGED",
    servesDecisions: false,
  },
} as const;

export type VancouverLegalPack = typeof VANCOUVER_LEGAL_PACK;

/** Canonical identity: pack id + each source's adapter, version and PDF hash. Readiness is deliberately excluded — it describes the pack, it does not identify it. */
export function legalPackDigest(pack: VancouverLegalPack = VANCOUVER_LEGAL_PACK): string {
  const identity = {
    legalPackId: pack.legalPackId,
    sources: pack.sources.map((s) => [s.zone, s.adapterId, s.adapterVersion, s.sourceVersionId, s.pdfSha256]),
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
