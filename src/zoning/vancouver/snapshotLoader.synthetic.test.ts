/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * E85 — Vancouver spatial loader integrity, HERMETIC. A SYNTHETIC two-feature
 * export and a manifest pinning it (through the loader's `manifest` seam) are
 * written to a temp folder, so every fail-closed check runs whether or not the
 * real evidence folder is present. Synthetic coordinates and ids only; no City
 * data. The real pinned release is exercised in snapshotLoader.test.ts.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canonicalRecordsJson,
  clearVancouverSpatialCache,
  loadVancouverSpatialEvidence,
  SPATIAL_MANIFEST_FILENAME,
  VancouverSpatialEvidenceError,
  type VancouverRawFeatureRecord,
  type VancouverSpatialFailureCode,
} from "./snapshotLoader.ts";
import { VANCOUVER_SPATIAL_MANIFEST, type VancouverSpatialManifest } from "./spatialManifest.ts";

const CRS = "urn:ogc:def:crs:EPSG::26910";
const square = (x: number, y: number): [number, number][] => [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]];

/** SYNTHETIC features in the City's schema. */
function syntheticFeatures(): object[] {
  return [
    { type: "Feature", properties: { object_id: "1", zoning_classification: "Residential", zoning_category: "R1", zoning_district: "R1-1", cd_1_number: null, geo_point_2d: { lon: -123.1, lat: 49.2 } }, geometry: { type: "Polygon", coordinates: [square(1000, 2000)] } },
    { type: "Feature", properties: { object_id: "2", zoning_classification: "Commercial", zoning_category: "C2", zoning_district: "C-2C", cd_1_number: null, geo_point_2d: { lon: -123.2, lat: 49.3 } }, geometry: { type: "Polygon", coordinates: [square(1100, 2100)] } },
  ];
}

function recordsOf(features: object[]): VancouverRawFeatureRecord[] {
  return features.map((f) => {
    const { properties: p, geometry: g } = f as { properties: VancouverRawFeatureRecord["rawAttributes"]; geometry: VancouverRawFeatureRecord["rawGeometry"] };
    return { rawFeatureId: p.object_id, rawAttributes: p, rawGeometry: { type: "Polygon", coordinates: g.coordinates } };
  });
}

/** A manifest that pins the synthetic bytes, content and normalized digest. */
function pinnedManifest(bytes: Buffer, features: object[]): VancouverSpatialManifest {
  const m = structuredClone(VANCOUVER_SPATIAL_MANIFEST) as any;
  m.bytes = { ...m.bytes, sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
  m.content = {
    featureCount: 2,
    geometryType: "Polygon",
    ringCount: 2,
    interiorRingCount: 0,
    vertexCount: 10,
    distinctZoningDistricts: 2,
    cd1NumberPresent: 0,
    classificationCounts: { Commercial: 1, Residential: 1 },
    districtCounts: { "R1-1": 1, "C-2C": 1 },
    bbox: [1000, 2000, 1110, 2110],
  };
  m.normalization = { ...m.normalization, normalizedDigest: createHash("sha256").update(canonicalRecordsJson(recordsOf(features))).digest("hex") };
  return m as VancouverSpatialManifest;
}

interface Fixture {
  readonly dir: string;
  readonly manifest: VancouverSpatialManifest;
}

/**
 * Writes a synthetic evidence folder. `edit` alters the GeoJSON text; with
 * `pinEdited` the manifest pins the edited bytes (so a later check is the one
 * under test), otherwise it pins the clean bytes.
 */
function fixture(opts: { edit?: (text: string) => string; pinEdited?: boolean; manifestOnDisk?: (m: any) => void; omitGeojson?: boolean } = {}): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "e85-van-syn-"));
  mkdirSync(path.join(dir, "vancouver-spatial"));
  const features = syntheticFeatures();
  const clean = JSON.stringify({ type: "FeatureCollection", crs: { type: "name", properties: { name: CRS } }, features });
  const text = opts.edit ? opts.edit(clean) : clean;
  const bytes = Buffer.from(text, "utf8");
  const manifest = pinnedManifest(opts.pinEdited ? bytes : Buffer.from(clean, "utf8"), features);
  if (!opts.omitGeojson) writeFileSync(path.join(dir, manifest.capture.evidencePath), bytes);
  const onDisk = structuredClone(manifest) as any;
  opts.manifestOnDisk?.(onDisk);
  writeFileSync(path.join(dir, "vancouver-spatial", SPATIAL_MANIFEST_FILENAME), JSON.stringify(onDisk));
  return { dir, manifest };
}

function expectFailure(code: VancouverSpatialFailureCode, fn: () => unknown): void {
  assert.throws(fn, (e: unknown) => e instanceof VancouverSpatialEvidenceError && e.code === code, `expected ${code}`);
}

describe("E85 Vancouver spatial loader — hermetic integrity (synthetic export)", () => {
  beforeEach(() => clearVancouverSpatialCache());

  test("a synthetic export that matches its manifest verifies", () => {
    const { dir, manifest } = fixture();
    const ev = loadVancouverSpatialEvidence({ evidenceDir: dir, manifest });
    assert.equal(ev.snapshot.rawFeatures.length, 2);
    assert.deepEqual(ev.summary.districtCounts, { "R1-1": 1, "C-2C": 1 });
    assert.ok(Object.isFrozen(ev.snapshot.rawFeatures));
  });

  test("missing evidence folder", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e85-van-syn-"));
    expectFailure("EVIDENCE_MISSING", () => loadVancouverSpatialEvidence({ evidenceDir: path.join(dir, "absent") }));
  });

  test("manifest present, GeoJSON missing", () => {
    const { dir, manifest } = fixture({ omitGeojson: true });
    expectFailure("EVIDENCE_MISSING", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
  });

  test("evidence manifest disagrees with the pinned identity", () => {
    const { dir, manifest } = fixture({ manifestOnDisk: (m) => (m.release.releaseId = "edited") });
    expectFailure("MANIFEST_IDENTITY_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
  });

  test("changed bytes, different length", () => {
    const { dir, manifest } = fixture({ edit: (t) => t + " " });
    expectFailure("BYTE_LENGTH_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
  });

  test("changed bytes, same length", () => {
    const { dir, manifest } = fixture({ edit: (t) => t.replace('"R1"', '"R2"') });
    expectFailure("HASH_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
  });

  test("CRS spelled differently", () => {
    const { dir, manifest } = fixture({ edit: (t) => t.replace(CRS, "EPSG:26910"), pinEdited: true });
    expectFailure("CRS_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
  });

  test("a classification outside the City's schema", () => {
    const { dir, manifest } = fixture({ edit: (t) => t.replace('"Commercial"', '"Commercials"'), pinEdited: true });
    expectFailure("SCHEMA_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
  });

  test("one vertex moved: bytes pinned, normalization is not", () => {
    const { dir, manifest } = fixture({ edit: (t) => t.replace("[1010,2000]", "[1010.5,2000]"), pinEdited: true });
    expectFailure("NORMALIZATION_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
  });

  test("a failed load is not cached", () => {
    const { dir, manifest } = fixture({ edit: (t) => t + " " });
    expectFailure("BYTE_LENGTH_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
    expectFailure("BYTE_LENGTH_MISMATCH", () => loadVancouverSpatialEvidence({ evidenceDir: dir, manifest }));
  });
});
