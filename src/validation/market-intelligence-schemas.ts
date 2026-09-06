/**
 * InvestScape™ Calculation Engine API
 * © 2026 Lighthouse Research Ltd. All rights reserved.
 *
 * InvestScape™ is a registered trademark of Lighthouse Research Ltd.
 * This software is proprietary and confidential.
 *
 * LICENSING:
 * - Personal/Educational Use: Permitted (see LICENSE)
 * - Commercial Use: Requires written Commercial License Agreement
 * Contact: wahjai604@gmail.com
 *
 * DISCLAIMER:
 * This software is provided "as-is" for informational purposes only.
 * Not investment advice, tax advice, or financial advice.
 * Use at your own risk.
 */

import { z } from "zod";
import { regionalMacroInputSchema, cityMarketInputSchema } from "./economic-schemas.js";

// ============================================================================
// Shared: MarketObservation / GeographyRef / SourceMetadata
// (market-intelligence-engine's domain.ts — the normalized model every
// MI route below operates on)
// ============================================================================

const geographyRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  level: z.enum(["country", "province_state", "metro", "city", "submarket", "neighbourhood", "postal_zip", "custom"]),
  parentId: z.string().min(1).optional(),
  countryCode: z.string().min(1),
  economicEngine: z.object({
    level: z.enum(["region", "city", "neighborhood"]),
    id: z.string().min(1),
    coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
  }),
});

const sourceMetadataSchema = z.object({
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  sourceType: z.enum(["government", "commercial", "brokerage", "user", "internal", "other"]),
  methodologyUrl: z.string().optional(),
  licenseNotes: z.string().optional(),
  retrievedAt: z.string().optional(),
});

export const marketObservationSchema = z.object({
  metricId: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "point_in_time"]),
  geography: geographyRefSchema,
  source: sourceMetadataSchema,
  releasedAt: z.string().optional(),
  effectiveAt: z.string().optional(),
  seasonalAdjustment: z.enum(["seasonally_adjusted", "not_adjusted", "unknown"]).optional(),
  revisionStatus: z.enum(["preliminary", "revised", "final", "unknown"]).optional(),
  sampleSize: z.number().optional(),
  marginOfError: z.number().optional(),
  confidenceLevel: z.number().optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

export type MarketObservationBody = z.infer<typeof marketObservationSchema>;

// ============================================================================
// E60: Comparability Validation
// ============================================================================

export const comparabilityInputSchema = z.object({
  a: marketObservationSchema,
  b: marketObservationSchema,
});

export const seriesComparabilityInputSchema = z.object({
  reference: marketObservationSchema,
  series: z.array(marketObservationSchema).min(1),
});

// ============================================================================
// E61: Geography Reconciliation
// ============================================================================

export const wrapRegionGeographyInputSchema = z.object({
  regionId: z.string().min(1),
  regionName: z.string().min(1),
});

export const wrapCityGeographyInputSchema = z.object({
  cityId: z.string().min(1),
  cityName: z.string().min(1),
  regionId: z.string().min(1),
  countryCode: z.string().min(1).optional(),
});

export const wrapNeighborhoodGeographyInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
  countryCode: z.string().min(1).optional(),
});

export const unwrapGeographyInputSchema = z.object({
  geography: geographyRefSchema,
});

export const countryCodeForRegionIdInputSchema = z.object({
  regionId: z.string().min(1),
});

// ============================================================================
// E62: Market Trend Analysis
// ============================================================================

export const observationSeriesInputSchema = z.object({
  observations: z.array(marketObservationSchema).min(1),
});

export const cagrOverSeriesInputSchema = observationSeriesInputSchema.extend({
  years: z.number().positive().optional(),
});

export const rollingSeriesInputSchema = observationSeriesInputSchema.extend({
  window: z.number().int().positive(),
});

export const indexedSeriesInputSchema = observationSeriesInputSchema.extend({
  baseValue: z.number().optional(),
});

// ============================================================================
// E63: Benchmark Comparison
// ============================================================================

export const benchmarkSubjectInputSchema = z.object({
  subject: marketObservationSchema,
  benchmarkSeries: z.array(marketObservationSchema),
});

// ============================================================================
// E64: Data Quality Assessment
// ============================================================================

const dataQualityWeightsSchema = z.object({
  completeness: z.number(),
  freshness: z.number(),
  sampleAdequacy: z.number(),
  geographicFit: z.number(),
  segmentSimilarity: z.number(),
  sourceReliability: z.number(),
});

export const assessDataQualityInputSchema = z.object({
  inputs: z.object({
    completeness: z.number().min(0).max(1),
    freshness: z.number().min(0).max(1),
    sampleAdequacy: z.number().min(0).max(1).optional(),
    geographicFit: z.number().min(0).max(1).optional(),
    segmentSimilarity: z.number().min(0).max(1).optional(),
    sourceReliability: z.number().min(0).max(1).optional(),
  }),
  weights: dataQualityWeightsSchema.optional(),
});

// ============================================================================
// E66: Neighborhood Snapshot / Orchestration Service
// (mirrors economic-schemas.ts's E31 neighborhoodDemographicsInputSchema
// shape exactly — same underlying NeighborhoodMetricsInput consumed by
// economic-engine's neighborhoodDemographics())
// ============================================================================

const neighborhoodMetricsInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  coordinates: z.object({ lat: z.number(), lng: z.number() }),
  asOfDate: z.coerce.date().optional(),
});

export const buildNeighborhoodSnapshotInputSchema = z.object({
  input: neighborhoodMetricsInputSchema,
  now: z.coerce.date().optional(),
});

export const benchmarkNeighborhoodMetricInputSchema = z.object({
  subjectInput: neighborhoodMetricsInputSchema,
  peerInputs: z.array(neighborhoodMetricsInputSchema),
  metricId: z.string().min(1),
  now: z.coerce.date().optional(),
});

// ============================================================================
// E65: Economic-Engine Adapters (fetchRegionObservations / fetchCityObservations /
// fetchNeighborhoodObservations) — input shapes are IDENTICAL to E29/E30's own
// RegionMetricsInput/CityMetricsInput (economic-engine-adapters.ts calls
// regionalMacroContext/cityMarketAnalysis directly with these), reused
// verbatim from economic-schemas.ts rather than redefined a second time.
// ============================================================================

export const fetchRegionObservationsInputSchema = z.object({
  input: regionalMacroInputSchema,
  now: z.coerce.date().optional(),
});

export const fetchCityObservationsInputSchema = z.object({
  input: cityMarketInputSchema,
  now: z.coerce.date().optional(),
});

export const fetchNeighborhoodObservationsInputSchema = z.object({
  input: neighborhoodMetricsInputSchema,
  now: z.coerce.date().optional(),
});
