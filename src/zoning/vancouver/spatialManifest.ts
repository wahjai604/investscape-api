/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E85 — the pinned identity of the ONE City of Vancouver zoning snapshot this
 * server may load.
 *
 * Contains information licensed under the Open Government Licence – Vancouver.
 *
 * These values are compiled into the server on purpose. The evidence folder
 * carries its own copy (`e85-pilot-evidence/vancouver-spatial/SPATIAL-MANIFEST.json`)
 * and the loader requires the two to agree field for field: a manifest that
 * travels with the bytes cannot, by being edited, widen what this build accepts.
 *
 * Every value was measured from the committed EPSG:26910 export itself
 * (git blob 4c573b3a24f10298da80c174b49f3f379cb4229d, root repo commit 6b6153d)
 * and independently re-derived — the SHA-256 by sha256sum, Python hashlib and
 * the committed blob; the structural counts by a separate Python pass that
 * shares no code with the TypeScript loader.
 *
 * There is exactly one accepted snapshot. The loader never downloads, never
 * falls back to the WGS84 export or the JSON export, and never substitutes a
 * subset: any mismatch is a refusal to start the zoning subsystem.
 */

export const VANCOUVER_SPATIAL_MANIFEST_VERSION = "e85-vancouver-spatial-manifest-1";

/** The only classification values the City's schema used in this release. Anything else is a schema mismatch, not a new category to guess at. */
export const VANCOUVER_ZONING_CLASSIFICATIONS = [
  "Commercial",
  "Comprehensive Development",
  "Historical Area",
  "Industrial",
  "Limited Agriculture",
  "Residential",
  "Residential Inclusive",
  "Residential Rental",
] as const;

/** Attribute names, in the City's schema order. Every feature must carry exactly these. */
export const VANCOUVER_ZONING_PROPERTY_KEYS = [
  "object_id",
  "zoning_classification",
  "zoning_category",
  "zoning_district",
  "cd_1_number",
  "geo_point_2d",
] as const;

export const VANCOUVER_SPATIAL_MANIFEST = {
  manifestVersion: VANCOUVER_SPATIAL_MANIFEST_VERSION,

  dataset: {
    jurisdictionId: "ca-bc-vancouver",
    datasetId: "ca-bc-vancouver:zoning-districts-and-labels",
    publisherDatasetIdentifier: "zoning-districts-and-labels",
    displayName: "City of Vancouver — Zoning Districts and Labels",
    publisher: "City of Vancouver",
    dataOwner: "City of Vancouver",
    dataTeam: "Planning, Urban Design & Sustainability - City-Wide & Regional Planning",
    datasetUrl: "https://opendata.vancouver.ca/explore/dataset/zoning-districts-and-labels/",
  },

  release: {
    /** E85's release label, derived from the City's DATA-processing state. A label, never parsed as a date. Matches the engine's VANCOUVER_ZONING_RELEASE. */
    releaseId: "2026-06-29-data-processing",
    cityModified: "2026-06-29T06:47",
    cityLastProcessingData: "2026-06-29T06:47",
    cityLastProcessingMetadata: "2026-09-14T06:47",
    /** The City prints these without a zone designator; none is invented here. */
    cityTimestampZone: "UNSTATED",
  },

  capture: {
    /**
     * When the local copy was captured. The only evidence is the Information
     * page screen capture (showing the 2026-09-14 metadata stamp) and the file
     * system time on the capturing workstation. Neither is a witnessed
     * retrieval, so this is recorded as a date with its basis and is never
     * presented as a retrievedAt.
     */
    captureDate: "2026-09-14",
    captureDateBasis: "LOCAL_FILE_MTIME_AND_SCREEN_CAPTURE_NOT_WITNESSED_RETRIEVAL",
    exportSelection: "GeoJSON, Export geographical coordinates as: EPSG:26910",
    /** Relative to the e85-pilot-evidence directory. The "espg" misspelling is the committed file name. */
    evidencePath: "vancouver-spatial/zoning-districts-and-labels-espg26910.geojson",
    gitBlob: "4c573b3a24f10298da80c174b49f3f379cb4229d",
    committedIn: "6b6153d",
  },

  bytes: {
    sha256: "35e65736c1a577eb38e2d5165b90c1e88946e13a28abe2711fd3773a7393a0ef",
    byteLength: 2664999,
    /** The file contains no line terminators, so core.autocrlf cannot rewrite it on checkout. */
    lineTerminators: 0,
  },

  crs: {
    /** Verbatim from the file's own `crs` member. Compared as an exact string; no canonicalization. */
    declaredCrsName: "urn:ogc:def:crs:EPSG::26910",
    displayName: "NAD83 / UTM zone 10N",
    units: "metre",
  },

  content: {
    featureCount: 1621,
    geometryType: "Polygon",
    ringCount: 1819,
    interiorRingCount: 198,
    vertexCount: 57480,
    distinctZoningDistricts: 964,
    cd1NumberPresent: 891,
    classificationCounts: {
      Commercial: 183,
      "Comprehensive Development": 911,
      "Historical Area": 5,
      Industrial: 68,
      "Limited Agriculture": 2,
      Residential: 345,
      "Residential Inclusive": 85,
      "Residential Rental": 22,
    },
    districtCounts: { "R1-1": 85, "C-2C": 11 },
    bbox: [483649.28479969146, 5449644.462396293, 498304.5436999692, 5462613.9036963545],
  },

  normalization: {
    /** Bump when the canonical form below changes; the pinned digest must be re-derived with it. */
    normalizationVersion: "vancouver-raw-records-1",
    /** sha256 of the canonical JSON of the structurally normalized records, in file order. See `canonicalRecordsJson`. */
    normalizedDigest: "a605a7e963772640f1c976896cb6314fd3483d9ce22e935329fab7caa68bd805",
  },

  licence: {
    name: "Open Government Licence – Vancouver",
    version: "1.0",
    status: "PUBLIC_REUSE",
    attribution: "Contains information licensed under the Open Government Licence – Vancouver.",
    noEndorsement: "No City logo, crest or official mark is reproduced, and no endorsement by the City of Vancouver is claimed or implied.",
  },

  temporal: {
    /** The City publishes no adoption, enactment or in-force date for these boundaries. No effectiveFrom exists. */
    effectiveDateBasis: "UNKNOWN",
    publicationCadence: "The City states the extract is updated weekly. Publication cadence only — not a legal effective date and not a freshness guarantee.",
  },

  knownQuarantine: {
    /**
     * Records E85 Phase 7's topology profile refuses in this release (measured
     * by the engine's full-snapshot suite, not re-derived by this loader). This
     * loader does NOT drop them: structural normalization keeps all 1,621, and
     * quarantine is Phase 8's decision.
     */
    featureIds: ["494447", "494523", "494568", "494688", "494721", "494810", "494869", "494873", "494885", "494949", "494963"],
    basis: "E85 Phase 7 topology profile (interior-ring contact); not a finding that the City published invalid geometry.",
  },
} as const;

export type VancouverSpatialManifest = typeof VANCOUVER_SPATIAL_MANIFEST;
