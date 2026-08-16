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

// Schemas for the dormant us-tax-strategies route family (E68-E70) — see
// src/routes/us-tax-strategies/*.ts for the "not yet registered" note.

// ============================================================================
// E68: Section 1031 Like-Kind Exchange
// ============================================================================

export const section1031InputSchema = z.object({
  jurisdiction: z.literal("US"),
  relinquishedSalePrice: z.number(),
  relinquishedClosingDate: z.string(), // ISO "YYYY-MM-DD"
  relinquishedAdjustedBasis: z.number(),
  accumulatedDepreciation: z.number(),
  replacementPropertyPrice: z.number(),
  relinquishedDebtPayoff: z.number(),
  replacementDebtAmount: z.number(),
  taxReturnDueDate: z.string(), // ISO "YYYY-MM-DD", including extensions
});

export type Section1031Input = z.infer<typeof section1031InputSchema>;

// ============================================================================
// E69: Cost Segregation
// ============================================================================

const costSegregationPropertyUseSchema = z.enum([
  "long_term_rental",
  "short_term_rental",
  "commercial",
]);

export const costSegregationInputSchema = z.object({
  jurisdiction: z.literal("US"),
  totalBuildingCostBasis: z.number(),
  propertyUse: costSegregationPropertyUseSchema,
  useBenchmarkDefault: z.boolean(),
  customFiveYearPercent: z.number().optional(),
  customFifteenYearPercent: z.number().optional(),
});

export type CostSegregationInput = z.infer<typeof costSegregationInputSchema>;

// ============================================================================
// E70: Opportunity Zones
// ============================================================================

const opportunityZoneRegimeSchema = z.enum(["legacy_2017", "permanent_2026"]);

export const opportunityZoneInputSchema = z.object({
  jurisdiction: z.literal("US"),
  regime: opportunityZoneRegimeSchema,
  investmentDate: z.string(), // ISO "YYYY-MM-DD"
  isRuralQOZ: z.boolean(),
  originalGainAmount: z.number(),
  substantialImprovementCompletedPercent: z.number(),
});

export type OpportunityZoneInput = z.infer<typeof opportunityZoneInputSchema>;
