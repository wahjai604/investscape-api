/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E85 — server-side loader for the pinned City of Vancouver zoning snapshot.
 *
 * Contains information licensed under the Open Government Licence – Vancouver.
 *
 * WHAT IT DOES, IN ORDER, AND WHERE IT STOPS:
 *
 *   1. Reads the evidence folder's SPATIAL-MANIFEST.json and requires it to
 *      equal the compiled manifest (identity, release, CRS, counts, digests).
 *   2. Reads the EPSG:26910 GeoJSON bytes; checks byte length, then SHA-256.
 *   3. Parses; checks the declared CRS string, the feature count, and the
 *      City's schema on every record.
 *   4. Structurally normalizes every record — verbatim — into the raw-record
 *      shape E85 Phase 8 consumes, and requires the canonical digest of that
 *      output, and every pinned count, to match.
 *   5. Optionally runs an injected Phase 8 normalizer once and caches its
 *      output under (snapshot identity, legal-pack identity, normalizer id).
 *
 * It serves nothing. There is no point lookup, no parcel lookup and no route
 * here, and nothing below consults a request.
 *
 * FAIL CLOSED: every check throws `VancouverSpatialEvidenceError`. There is no
 * retry, no download, no alternative export and no partial result. A failed
 * load is not cached, so the next call re-verifies from disk rather than
 * inheriting a half-built state.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  VANCOUVER_SPATIAL_MANIFEST,
  VANCOUVER_ZONING_CLASSIFICATIONS,
  VANCOUVER_ZONING_PROPERTY_KEYS,
  type VancouverSpatialManifest,
} from "./spatialManifest.ts";
import { VANCOUVER_LEGAL_PACK, legalPackDigest, type VancouverLegalPack } from "./legalPack.ts";

export type VancouverSpatialFailureCode =
  | "EVIDENCE_MISSING"
  | "MANIFEST_IDENTITY_MISMATCH"
  | "BYTE_LENGTH_MISMATCH"
  | "HASH_MISMATCH"
  | "PARSE_FAILED"
  | "CRS_MISMATCH"
  | "FEATURE_COUNT_MISMATCH"
  | "SCHEMA_MISMATCH"
  | "NORMALIZATION_MISMATCH";

export class VancouverSpatialEvidenceError extends Error {
  readonly code: VancouverSpatialFailureCode;
  constructor(code: VancouverSpatialFailureCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "VancouverSpatialEvidenceError";
    this.code = code;
  }
}

const fail = (code: VancouverSpatialFailureCode, message: string): never => {
  throw new VancouverSpatialEvidenceError(code, message);
};

/* ------------------------------------------------------------------------- *
 * Output shapes. Structurally identical to the engine's
 * E85RawSpatialFeatureRecord / E85RawSpatialSourceSnapshot so the snapshot can
 * be handed to `normalizeE85SpatialSnapshot` unchanged once an engine build
 * that ships E85 is vendored. Declared here rather than imported because the
 * vendored engine (0.3.0) does not export them.
 * ------------------------------------------------------------------------- */

export interface VancouverGeoPoint {
  readonly lon: number;
  readonly lat: number;
}

export interface VancouverRawAttributes {
  readonly object_id: string;
  readonly zoning_classification: string;
  readonly zoning_category: string;
  readonly zoning_district: string;
  readonly cd_1_number: string | null;
  readonly geo_point_2d: VancouverGeoPoint;
}

export interface VancouverRawPolygon {
  readonly type: "Polygon";
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

export interface VancouverRawFeatureRecord {
  readonly rawFeatureId: string;
  readonly rawAttributes: VancouverRawAttributes;
  readonly rawGeometry: VancouverRawPolygon;
}

export interface VancouverRawSpatialSnapshot {
  readonly snapshotId: string;
  readonly datasetId: string;
  readonly datasetVersionId: string;
  readonly jurisdictionId: string;
  readonly sourceSystem: "GEOJSON";
  readonly declaredCrs: { readonly crsId: string; readonly displayName: string; readonly declaredBy: string; readonly units: string };
  readonly rawFeatures: readonly VancouverRawFeatureRecord[];
  /** `retrievedAt` is deliberately absent: no retrieval was witnessed. */
  readonly sourceMetadata: Readonly<Record<string, string | number>>;
}

export interface VancouverSnapshotSummary {
  readonly featureCount: number;
  readonly ringCount: number;
  readonly interiorRingCount: number;
  readonly vertexCount: number;
  readonly distinctZoningDistricts: number;
  readonly cd1NumberPresent: number;
  readonly classificationCounts: Readonly<Record<string, number>>;
  readonly districtCounts: Readonly<Record<string, number>>;
  readonly bbox: readonly [number, number, number, number];
}

export interface VancouverPhase8Normalizer<T> {
  /** Identifies the normalizer build (e.g. engine package + version + adapter version). Part of the cache key. */
  readonly normalizerId: string;
  /** Must be pure over its input. Receives the legal pack so linkage is keyed, never guessed. */
  run(snapshot: VancouverRawSpatialSnapshot, legalPack: VancouverLegalPack): T;
}

export interface VancouverSpatialEvidence<T = never> {
  readonly cacheKey: string;
  readonly manifest: VancouverSpatialManifest;
  readonly legalPack: VancouverLegalPack;
  readonly legalPackDigest: string;
  readonly snapshot: VancouverRawSpatialSnapshot;
  readonly summary: VancouverSnapshotSummary;
  readonly normalizedDigest: string;
  /** Present only when a Phase 8 normalizer was injected. */
  readonly phase8?: { readonly normalizerId: string; readonly output: T };
  readonly timings: { readonly readMs: number; readonly hashMs: number; readonly parseMs: number; readonly normalizeMs: number; readonly phase8Ms: number; readonly totalMs: number };
}

export interface LoadVancouverSpatialOptions<T> {
  /** The e85-pilot-evidence directory. Required: there is no default location to fall back to. */
  readonly evidenceDir: string;
  readonly phase8?: VancouverPhase8Normalizer<T>;
  /** Test seams. Production uses the compiled constants. */
  readonly manifest?: VancouverSpatialManifest;
  readonly legalPack?: VancouverLegalPack;
}

export const SPATIAL_MANIFEST_FILENAME = "SPATIAL-MANIFEST.json";

/* ------------------------------------------------------------------------- *
 * Cache: one normalization per (snapshot, legal pack, normalizer).
 * ------------------------------------------------------------------------- */

const cache = new Map<string, VancouverSpatialEvidence<unknown>>();

export function vancouverSpatialCacheKey(manifest: VancouverSpatialManifest, pack: VancouverLegalPack, normalizerId?: string): string {
  return [
    `${manifest.dataset.datasetId}@${manifest.release.releaseId}`,
    `sha256:${manifest.bytes.sha256}`,
    `norm:${manifest.normalization.normalizationVersion}`,
    `legal:${pack.legalPackId}@${legalPackDigest(pack)}`,
    `phase8:${normalizerId ?? "none"}`,
  ].join("|");
}

/** For tests and for an operator-triggered reload. Never called on a request path. */
export function clearVancouverSpatialCache(): void {
  cache.clear();
}

export function loadVancouverSpatialEvidence<T = never>(options: LoadVancouverSpatialOptions<T>): VancouverSpatialEvidence<T> {
  const manifest = options.manifest ?? VANCOUVER_SPATIAL_MANIFEST;
  const pack = options.legalPack ?? VANCOUVER_LEGAL_PACK;
  const key = vancouverSpatialCacheKey(manifest, pack, options.phase8?.normalizerId);
  const hit = cache.get(key);
  if (hit !== undefined) return hit as VancouverSpatialEvidence<T>;
  const loaded = loadUncached(options.evidenceDir, manifest, pack, key, options.phase8);
  cache.set(key, loaded as VancouverSpatialEvidence<unknown>);
  return loaded;
}

/* ------------------------------------------------------------------------- *
 * The checks.
 * ------------------------------------------------------------------------- */

function loadUncached<T>(evidenceDir: string, manifest: VancouverSpatialManifest, pack: VancouverLegalPack, cacheKey: string, phase8?: VancouverPhase8Normalizer<T>): VancouverSpatialEvidence<T> {
  const t0 = performance.now();

  // 1. The manifest travelling with the bytes must equal the compiled one.
  const manifestPath = path.join(evidenceDir, "vancouver-spatial", SPATIAL_MANIFEST_FILENAME);
  let onDisk: unknown;
  try {
    onDisk = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    fail("EVIDENCE_MISSING", `cannot read ${manifestPath}: ${(e as Error).message}`);
  }
  const diff = firstDifference(manifest, onDisk);
  if (diff !== null) fail("MANIFEST_IDENTITY_MISMATCH", `evidence manifest differs from the compiled manifest at ${diff}`);

  // 2. Bytes: length before hashing, so a truncated or substituted file is refused cheaply.
  const geojsonPath = path.join(evidenceDir, manifest.capture.evidencePath);
  let size: number;
  try {
    size = statSync(geojsonPath).size;
  } catch (e) {
    return fail("EVIDENCE_MISSING", `cannot stat ${geojsonPath}: ${(e as Error).message}`);
  }
  if (size !== manifest.bytes.byteLength) fail("BYTE_LENGTH_MISMATCH", `expected ${manifest.bytes.byteLength} bytes, found ${size}`);
  const bytes = readFileSync(geojsonPath);
  const t1 = performance.now();
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== manifest.bytes.sha256) fail("HASH_MISMATCH", `expected sha256 ${manifest.bytes.sha256}, found ${sha}`);
  const t2 = performance.now();

  // 3. Parse, CRS, count.
  let doc: { type?: unknown; crs?: { type?: unknown; properties?: { name?: unknown } }; features?: unknown };
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return fail("PARSE_FAILED", (e as Error).message);
  }
  if (doc.type !== "FeatureCollection") fail("SCHEMA_MISMATCH", `top-level type is ${String(doc.type)}`);
  const crsName = doc.crs?.type === "name" ? doc.crs.properties?.name : undefined;
  if (crsName !== manifest.crs.declaredCrsName) fail("CRS_MISMATCH", `file declares ${JSON.stringify(crsName)}, manifest pins ${manifest.crs.declaredCrsName}`);
  if (!Array.isArray(doc.features)) return fail("SCHEMA_MISMATCH", "features is not an array");
  if (doc.features.length !== manifest.content.featureCount) fail("FEATURE_COUNT_MISMATCH", `expected ${manifest.content.featureCount} features, found ${doc.features.length}`);
  const t3 = performance.now();

  // 4. Structural normalization, then compare everything pinned.
  const records = doc.features.map((f, i) => normalizeFeature(f, i));
  const ids = new Set(records.map((r) => r.rawFeatureId));
  if (ids.size !== records.length) fail("SCHEMA_MISMATCH", `object_id is not unique (${ids.size} distinct of ${records.length})`);
  const summary = summarize(records);
  const summaryDiff = firstDifference(manifest.content, { ...summary, geometryType: "Polygon" });
  if (summaryDiff !== null) fail("NORMALIZATION_MISMATCH", `normalized content differs from the manifest at content${summaryDiff.slice(1)}`);
  const normalizedDigest = createHash("sha256").update(canonicalRecordsJson(records)).digest("hex");
  if (normalizedDigest !== manifest.normalization.normalizedDigest) {
    fail("NORMALIZATION_MISMATCH", `normalized digest ${normalizedDigest} does not match pinned ${manifest.normalization.normalizedDigest}`);
  }
  const snapshot = buildSnapshot(manifest, records);
  const t4 = performance.now();

  // 5. Optional Phase 8, once.
  const phase8Result = phase8 === undefined ? undefined : { normalizerId: phase8.normalizerId, output: phase8.run(snapshot, pack) };
  const t5 = performance.now();

  return deepFreeze({
    cacheKey,
    manifest,
    legalPack: pack,
    legalPackDigest: legalPackDigest(pack),
    snapshot,
    summary,
    normalizedDigest,
    ...(phase8Result === undefined ? {} : { phase8: phase8Result }),
    timings: { readMs: t1 - t0, hashMs: t2 - t1, parseMs: t3 - t2, normalizeMs: t4 - t3, phase8Ms: t5 - t4, totalMs: t5 - t0 },
  }) as VancouverSpatialEvidence<T>;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const CLASSIFICATIONS: ReadonlySet<string> = new Set(VANCOUVER_ZONING_CLASSIFICATIONS);

/** Copies values verbatim — no rounding, re-winding, closing or trimming. Rejects anything outside the City's schema. */
function normalizeFeature(f: unknown, index: number): VancouverRawFeatureRecord {
  const where = `feature[${index}]`;
  const bad = (msg: string): never => fail("SCHEMA_MISMATCH", `${where}: ${msg}`);
  if (typeof f !== "object" || f === null) return bad("not an object");
  const feat = f as { type?: unknown; properties?: Record<string, unknown>; geometry?: { type?: unknown; coordinates?: unknown } };
  if (feat.type !== "Feature") bad(`type is ${String(feat.type)}`);
  const p = feat.properties;
  if (typeof p !== "object" || p === null) return bad("properties missing");
  const keys = Object.keys(p).sort();
  const expected = [...VANCOUVER_ZONING_PROPERTY_KEYS].sort();
  if (keys.join(",") !== expected.join(",")) bad(`property keys [${keys.join(",")}] are not the City's schema`);

  const { object_id, zoning_classification, zoning_category, zoning_district, cd_1_number, geo_point_2d } = p;
  if (typeof object_id !== "string" || !/^[0-9]+$/.test(object_id)) bad(`object_id ${JSON.stringify(object_id)} is not a digit string`);
  if (typeof zoning_classification !== "string" || !CLASSIFICATIONS.has(zoning_classification)) bad(`unknown zoning_classification ${JSON.stringify(zoning_classification)}`);
  if (typeof zoning_category !== "string" || zoning_category === "") bad("zoning_category missing");
  if (typeof zoning_district !== "string" || zoning_district === "") bad("zoning_district missing");
  if (cd_1_number !== null && typeof cd_1_number !== "string") bad("cd_1_number is neither null nor a string");
  const gp = geo_point_2d as { lon?: unknown; lat?: unknown } | null;
  if (typeof gp !== "object" || gp === null || Object.keys(gp).length !== 2 || !isFiniteNumber(gp.lon) || !isFiniteNumber(gp.lat)) bad("geo_point_2d is not {lon,lat}");

  const g = feat.geometry;
  if (typeof g !== "object" || g === null || g.type !== "Polygon" || !Array.isArray(g.coordinates) || g.coordinates.length === 0) return bad("geometry is not a Polygon");
  const rings = (g.coordinates as unknown[]).map((ring, r) => {
    if (!Array.isArray(ring) || ring.length < 4) return bad(`ring ${r} has fewer than 4 positions`);
    const positions = ring.map((pos) => {
      if (!Array.isArray(pos) || pos.length !== 2 || !isFiniteNumber(pos[0]) || !isFiniteNumber(pos[1])) return bad(`ring ${r} has a non-2D or non-finite position`);
      return [pos[0], pos[1]] as const;
    });
    const [a, z] = [positions[0], positions[positions.length - 1]];
    if (a[0] !== z[0] || a[1] !== z[1]) bad(`ring ${r} is not closed`);
    return positions;
  });

  return {
    rawFeatureId: object_id as string,
    rawAttributes: {
      object_id: object_id as string,
      zoning_classification: zoning_classification as string,
      zoning_category: zoning_category as string,
      zoning_district: zoning_district as string,
      cd_1_number: cd_1_number as string | null,
      geo_point_2d: { lon: gp!.lon as number, lat: gp!.lat as number },
    },
    rawGeometry: { type: "Polygon", coordinates: rings },
  };
}

function summarize(records: readonly VancouverRawFeatureRecord[]): VancouverSnapshotSummary {
  const classificationCounts: Record<string, number> = {};
  const districts = new Map<string, number>();
  let ringCount = 0;
  let vertexCount = 0;
  let cd1 = 0;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of records) {
    const a = r.rawAttributes;
    classificationCounts[a.zoning_classification] = (classificationCounts[a.zoning_classification] ?? 0) + 1;
    districts.set(a.zoning_district, (districts.get(a.zoning_district) ?? 0) + 1);
    if (a.cd_1_number !== null) cd1 += 1;
    for (const ring of r.rawGeometry.coordinates) {
      ringCount += 1;
      vertexCount += ring.length;
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const sortedClassifications = Object.fromEntries(Object.entries(classificationCounts).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    featureCount: records.length,
    ringCount,
    interiorRingCount: ringCount - records.length,
    vertexCount,
    distinctZoningDistricts: districts.size,
    cd1NumberPresent: cd1,
    classificationCounts: sortedClassifications,
    districtCounts: { "R1-1": districts.get("R1-1") ?? 0, "C-2C": districts.get("C-2C") ?? 0 },
    bbox: [minX, minY, maxX, maxY],
  };
}

/**
 * The canonical form the normalized digest is taken over: records in FILE
 * ORDER, attribute keys in the City's schema order, coordinates as JavaScript
 * serializes them. Any change here is a new `normalizationVersion`.
 */
export function canonicalRecordsJson(records: readonly VancouverRawFeatureRecord[]): string {
  return JSON.stringify(
    records.map((r) => [
      r.rawFeatureId,
      VANCOUVER_ZONING_PROPERTY_KEYS.map((k) => r.rawAttributes[k]),
      r.rawGeometry.type,
      r.rawGeometry.coordinates,
    ]),
  );
}

function buildSnapshot(m: VancouverSpatialManifest, records: readonly VancouverRawFeatureRecord[]): VancouverRawSpatialSnapshot {
  return {
    snapshotId: `${m.dataset.datasetId}@${m.release.releaseId}#sha256:${m.bytes.sha256}`,
    datasetId: m.dataset.datasetId,
    datasetVersionId: m.release.releaseId,
    jurisdictionId: m.dataset.jurisdictionId,
    sourceSystem: "GEOJSON",
    declaredCrs: {
      crsId: m.crs.declaredCrsName,
      displayName: m.crs.displayName,
      declaredBy: "City of Vancouver GeoJSON export — file-level crs member",
      units: m.crs.units,
    },
    rawFeatures: records,
    sourceMetadata: {
      attribution: m.licence.attribution,
      licenceName: m.licence.name,
      licenceVersion: m.licence.version,
      publisher: m.dataset.publisher,
      publisherDatasetIdentifier: m.dataset.publisherDatasetIdentifier,
      datasetUrl: m.dataset.datasetUrl,
      cityModified: m.release.cityModified,
      cityLastProcessingData: m.release.cityLastProcessingData,
      cityLastProcessingMetadata: m.release.cityLastProcessingMetadata,
      captureDate: m.capture.captureDate,
      captureDateBasis: m.capture.captureDateBasis,
      exportCrsSelection: "EPSG:26910",
      contentSha256: m.bytes.sha256,
      effectiveDateBasis: m.temporal.effectiveDateBasis,
      fullReleaseRecordCount: m.content.featureCount,
    },
  };
}

/** Returns the JSON path of the first difference, or null. Order-insensitive for object keys, order-sensitive for arrays. */
function firstDifference(expected: unknown, actual: unknown, at = "$"): string | null {
  if (typeof expected !== "object" || expected === null) return Object.is(expected, actual) ? null : at;
  if (typeof actual !== "object" || actual === null) return at;
  if (Array.isArray(expected) !== Array.isArray(actual)) return at;
  const ek = Object.keys(expected);
  const ak = Object.keys(actual);
  if (ek.length !== ak.length) return at;
  for (const k of ek) {
    if (!Object.prototype.hasOwnProperty.call(actual, k)) return `${at}.${k}`;
    const d = firstDifference((expected as Record<string, unknown>)[k], (actual as Record<string, unknown>)[k], `${at}.${k}`);
    if (d !== null) return d;
  }
  return null;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
