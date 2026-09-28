/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * Contains information licensed under the Open Government Licence – Vancouver.
 *
 * Reads the pinned export from the sibling workspace evidence folder. Where that
 * folder is absent the suite is skipped and says so; it never substitutes a
 * subset. Tamper cases write modified copies to a temp directory.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearVancouverSpatialCache,
  loadVancouverSpatialEvidence,
  SPATIAL_MANIFEST_FILENAME,
  VancouverSpatialEvidenceError,
  type VancouverSpatialFailureCode,
} from "./snapshotLoader.ts";
import { VANCOUVER_SPATIAL_MANIFEST, type VancouverSpatialManifest } from "./spatialManifest.ts";
import { VANCOUVER_LEGAL_PACK, legalPackDigest, type VancouverLegalPack } from "./legalPack.ts";
import { VANCOUVER_PID_LOOKUP, VANCOUVER_POINT_RESPONSE_SCOPE, VancouverPidLookupUnavailableError, lookupVancouverZoningByPid } from "./pointScope.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(here, "../../../../e85-pilot-evidence");
const GEOJSON = path.join(EVIDENCE_DIR, VANCOUVER_SPATIAL_MANIFEST.capture.evidencePath);
const HAVE_EVIDENCE = existsSync(GEOJSON);
if (!HAVE_EVIDENCE) console.warn(`Vancouver spatial evidence not found at ${GEOJSON}; the loader suite is skipped.`);

const M = VANCOUVER_SPATIAL_MANIFEST;

function expectFailure(code: VancouverSpatialFailureCode, fn: () => unknown): void {
  assert.throws(fn, (e: unknown) => e instanceof VancouverSpatialEvidenceError && e.code === code, `expected ${code}`);
}

/** Writes a tampered copy plus a manifest that pins the TAMPERED bytes, so the check under test is the first one that can fail. */
function tampered(edit: (text: string) => string, pinBytes = true, editManifest: (m: any) => void = () => {}): { dir: string; manifest: VancouverSpatialManifest } {
  const dir = mkdtempSync(path.join(tmpdir(), "e85-van-"));
  mkdirSync(path.join(dir, "vancouver-spatial"));
  const original = readFileSync(GEOJSON, "utf8");
  const text = edit(original);
  assert.notEqual(text, original, "tamper edit must change the file");
  const bytes = Buffer.from(text, "utf8");
  writeFileSync(path.join(dir, M.capture.evidencePath), bytes);
  const manifest = structuredClone(M) as any;
  if (pinBytes) manifest.bytes = { ...manifest.bytes, sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
  editManifest(manifest);
  writeFileSync(path.join(dir, "vancouver-spatial", SPATIAL_MANIFEST_FILENAME), JSON.stringify(manifest));
  return { dir, manifest };
}

(HAVE_EVIDENCE ? describe : describe.skip)("E85 Vancouver spatial evidence loader — the pinned snapshot", () => {
  beforeEach(() => clearVancouverSpatialCache());

  test("loads, verifies and normalizes all 1,621 records of the pinned release", () => {
    const ev = loadVancouverSpatialEvidence({ evidenceDir: EVIDENCE_DIR });
    assert.equal(ev.snapshot.rawFeatures.length, 1621);
    assert.equal(ev.normalizedDigest, M.normalization.normalizedDigest);
    assert.deepEqual(ev.summary.classificationCounts, M.content.classificationCounts);
    assert.deepEqual(ev.summary.districtCounts, { "R1-1": 85, "C-2C": 11 });
    assert.equal(ev.snapshot.declaredCrs.crsId, "urn:ogc:def:crs:EPSG::26910");
    assert.equal(ev.snapshot.datasetVersionId, "2026-06-29-data-processing");
    assert.ok(ev.snapshot.snapshotId.endsWith(`#sha256:${M.bytes.sha256}`));
    assert.equal(ev.snapshot.sourceMetadata.effectiveDateBasis, "UNKNOWN");
    assert.equal(ev.snapshot.sourceMetadata.attribution, "Contains information licensed under the Open Government Licence – Vancouver.");
    assert.equal("retrievedAt" in ev.snapshot, false, "no retrieval was witnessed, so none is stamped");
    assert.equal(ev.phase8, undefined);
  });

  test("the evidence manifest on disk is byte-for-byte the compiled one", () => {
    const onDisk = JSON.parse(readFileSync(path.join(EVIDENCE_DIR, "vancouver-spatial", SPATIAL_MANIFEST_FILENAME), "utf8"));
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(M)));
  });

  test("structural normalization quarantines nothing: the 11 Phase 7 refusals are still present, verbatim", () => {
    const ev = loadVancouverSpatialEvidence({ evidenceDir: EVIDENCE_DIR });
    const ids = new Set(ev.snapshot.rawFeatures.map((r) => r.rawFeatureId));
    for (const id of M.knownQuarantine.featureIds) assert.ok(ids.has(id), `${id} must reach Phase 8`);
    const r11 = ev.snapshot.rawFeatures.find((r) => r.rawFeatureId === "494787")!;
    assert.deepEqual(r11.rawGeometry.coordinates[0][0], [493493.43189987674, 5456046.973596323]);
    assert.equal(r11.rawAttributes.zoning_district, "R1-1");
  });

  test("the result is frozen", () => {
    const ev = loadVancouverSpatialEvidence({ evidenceDir: EVIDENCE_DIR });
    assert.ok(Object.isFrozen(ev.snapshot.rawFeatures[0].rawGeometry.coordinates[0]));
    assert.throws(() => {
      (ev.snapshot.rawFeatures as unknown as unknown[]).push({});
    });
  });

  test("normalizes once: a second load with the same identities is the same object", () => {
    const a = loadVancouverSpatialEvidence({ evidenceDir: EVIDENCE_DIR });
    const b = loadVancouverSpatialEvidence({ evidenceDir: "/nonexistent — a cache hit never touches disk" });
    assert.equal(a, b);
  });

  test("the cache is keyed by legal-pack identity: a different pack never reuses a normalization", () => {
    const a = loadVancouverSpatialEvidence({ evidenceDir: EVIDENCE_DIR });
    const otherPack = structuredClone(VANCOUVER_LEGAL_PACK) as any as VancouverLegalPack;
    (otherPack.sources[1] as any).pdfSha256 = "0".repeat(64);
    assert.notEqual(legalPackDigest(otherPack), legalPackDigest());
    const b = loadVancouverSpatialEvidence({ evidenceDir: EVIDENCE_DIR, legalPack: otherPack });
    assert.notEqual(a, b);
    assert.notEqual(a.cacheKey, b.cacheKey);
    assert.ok(a.cacheKey.includes(`sha256:${M.bytes.sha256}`));
    assert.ok(a.cacheKey.includes(`legal:${VANCOUVER_LEGAL_PACK.legalPackId}@${legalPackDigest()}`));
  });

  test("an injected Phase 8 normalizer runs once per (snapshot, legal pack, normalizer) and receives the legal pack", () => {
    let runs = 0;
    const phase8 = {
      normalizerId: "test-normalizer@1",
      run: (snap: { rawFeatures: readonly unknown[] }, pack: VancouverLegalPack) => {
        runs += 1;
        return { features: snap.rawFeatures.length, pack: pack.legalPackId };
      },
    };
    const a = loadVancouverSpatialEvidence({ evidenceDir: EVIDENCE_DIR, phase8 });
    const b = loadVancouverSpatialEvidence({ evidenceDir: EVIDENCE_DIR, phase8 });
    assert.equal(runs, 1);
    assert.equal(a, b);
    assert.deepEqual(a.phase8, { normalizerId: "test-normalizer@1", output: { features: 1621, pack: VANCOUVER_LEGAL_PACK.legalPackId } });
  });

  describe("fails closed", () => {
    test("missing evidence manifest", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "e85-van-"));
      expectFailure("EVIDENCE_MISSING", () => loadVancouverSpatialEvidence({ evidenceDir: dir }));
    });

    test("evidence manifest disagrees with the compiled identity", () => {
      const { dir } = tampered((t) => t + " ", false, (m) => {
        m.release.releaseId = "2026-09-14-data-processing";
      });
      expectFailure("MANIFEST_IDENTITY_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir }));
    });

    test("byte length differs", () => {
      const { dir } = tampered((t) => t + " ", false);
      expectFailure("BYTE_LENGTH_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir }));
    });

    test("same length, different bytes", () => {
      const { dir } = tampered((t) => t.replace("488932.18389979115", "488932.18389979116"), false);
      expectFailure("HASH_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir }));
    });

    test("CRS spelled differently, even when it names the same EPSG code", () => {
      const { dir, manifest } = tampered((t) => t.replace("urn:ogc:def:crs:EPSG::26910", "EPSG:26910"));
      expectFailure("CRS_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
    });

    test("a feature is missing", () => {
      const { dir, manifest } = tampered((t) => {
        const doc = JSON.parse(t);
        doc.features.pop();
        return JSON.stringify(doc);
      });
      expectFailure("FEATURE_COUNT_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
    });

    test("a classification outside the City's schema", () => {
      const { dir, manifest } = tampered((t) => t.replace('"Residential Rental"', '"Residential Rentals"'));
      expectFailure("SCHEMA_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
    });

    test("an extra attribute", () => {
      const { dir, manifest } = tampered((t) => t.replace('"object_id":"494428"', '"object_id":"494428","pid":"000-000-000"'));
      expectFailure("SCHEMA_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
    });

    test("one vertex moved: bytes and schema pass, normalization does not", () => {
      const { dir, manifest } = tampered((t) => t.replace("488942.36299979157", "488942.46299979157"));
      expectFailure("NORMALIZATION_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
    });

    test("a failed load is not cached", () => {
      const { dir } = tampered((t) => t + " ", false);
      expectFailure("BYTE_LENGTH_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir }));
      expectFailure("BYTE_LENGTH_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir }));
    });
  });
});

describe("E85 Vancouver — what is deliberately NOT available", () => {
  test("PID lookup is unavailable and always refuses", () => {
    assert.equal(VANCOUVER_PID_LOOKUP.available, false);
    assert.throws(() => lookupVancouverZoningByPid("012-345-678"), VancouverPidLookupUnavailableError);
  });

  test("a future point response states it is zoning at a point, not a parcel entitlement", () => {
    assert.match(VANCOUVER_POINT_RESPONSE_SCOPE, /zoning mapped at a single point/);
    assert.match(VANCOUVER_POINT_RESPONSE_SCOPE, /not the entitlement of a parcel/);
  });

  test("the legal pack is packaged but not released, and serves no decisions", () => {
    assert.equal(VANCOUVER_LEGAL_PACK.readiness.status, "PACKAGED_NOT_RELEASED");
    assert.equal(VANCOUVER_LEGAL_PACK.readiness.servesDecisions, false);
  });
});
