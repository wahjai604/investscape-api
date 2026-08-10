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

const jurisdictionSchema = z.enum(["CA", "US"]);
const filingStatusSchema = z.enum(["single", "married", "head_of_household"]);
const propertyTypeSchema = z.enum(["residential", "commercial"]);

// ============================================================================
// E46: Tax Aggregation
// ============================================================================

const taxAggregationPropertySchema = z.object({
  address: z.string(),
  rentalIncome: z.number(),
  rentalExpenses: z.number(),
  mortgageInterestPaid: z.number(),
  mortgagePrincipal: z.number(),
  depreciation: z.number(),
  capGains: z.number().optional(),
});

export const taxAggregationInputSchema = z.object({
  properties: z.array(taxAggregationPropertySchema),
  jurisdiction: jurisdictionSchema,
  province: z.string().optional(),
  state: z.string().optional(),
  filingStatus: filingStatusSchema,
  otherIncome: z.number(),
  realEstateProfessional: z.boolean().optional(),
  year: z.number(),
});

export type TaxAggregationInput = z.infer<typeof taxAggregationInputSchema>;

// ============================================================================
// E47: Personal Income Tax
// ============================================================================

export const personalIncomeTaxInputSchema = z.object({
  totalIncome: z.number(),
  jurisdiction: jurisdictionSchema,
  province: z.string().optional(),
  state: z.string().optional(),
  filingStatus: filingStatusSchema,
  year: z.number(),
  capitalGainsIncome: z.number().optional(),
  capitalGainsInclusionRate: z.number().optional(),
  dependents: z.number().optional(),
});

export type PersonalIncomeTaxInput = z.infer<typeof personalIncomeTaxInputSchema>;

// ============================================================================
// E48: Depreciation
// ============================================================================

export const depreciationInputSchema = z.object({
  jurisdiction: jurisdictionSchema,
  purchasePrice: z.number(),
  buildingCost: z.number(),
  landCost: z.number(),
  propertyType: propertyTypeSchema,
  acquisitionYear: z.number(),
  currentYear: z.number(),
  holdingYears: z.number().optional(),
  salePrice: z.number().optional(),
  saleYear: z.number().optional(),
  priorYearClosingUCC: z.number().optional(),
  priorCumulativeDepreciation: z.number().optional(),
  investorMarginalTaxRate: z.number().optional(),
});

export type DepreciationInput = z.infer<typeof depreciationInputSchema>;

// ============================================================================
// E49: Mortgage Interest
// ============================================================================

export const mortgageInterestInputSchema = z.object({
  jurisdiction: jurisdictionSchema,
  loanAmount: z.number(),
  annualRate: z.number(),
  amortizationYears: z.number(),
  originationYear: z.number(),
  currentYear: z.number(),
  paymentFrequency: z.enum(["annual", "semi-annual", "monthly"]).optional(),
  priorYearEndingBalance: z.number().optional(),
});

export type MortgageInterestInput = z.infer<typeof mortgageInterestInputSchema>;

// ============================================================================
// E50: Operating Expense
// ============================================================================

const operatingExpenseLineItemSchema = z.object({
  description: z.string(),
  amount: z.number(),
  category: z.string().optional(),
});

export const operatingExpenseInputSchema = z.object({
  jurisdiction: jurisdictionSchema,
  province: z.string().optional(),
  propertyType: propertyTypeSchema.optional(),
  expenses: z.array(operatingExpenseLineItemSchema),
  autoCapitalizeThreshold: z.number().optional(),
});

export type OperatingExpenseInput = z.infer<typeof operatingExpenseInputSchema>;

// ============================================================================
// E51: Developer Profit
// ============================================================================

const developerSoftCostDetailsSchema = z.object({
  architecturalEngineering: z.number(),
  permits: z.number(),
  insurance: z.number(),
  management: z.number(),
  financing: z.number(),
  advertising: z.number(),
  other: z.number(),
});

export const developerProfitInputSchema = z.object({
  jurisdiction: jurisdictionSchema,
  province: z.string().optional(),
  state: z.string().optional(),
  totalRevenueFromSales: z.number(),
  hardCosts: z.number(),
  softCosts: z.number(),
  softCostDetails: developerSoftCostDetailsSchema.optional(),
  gstHstOwing: z.number().optional(),
  developmentChargesOwing: z.number().optional(),
  realEstateProfessional: z.boolean().optional(),
  developerMarginalTaxRate: z.number().optional(),
});

export type DeveloperProfitInput = z.infer<typeof developerProfitInputSchema>;

// ============================================================================
// E52: GST/HST & Development Charges
// ============================================================================

const gstHstProvinceSchema = z.enum(["BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL"]);

export const gstHstDevChargesInputSchema = z.object({
  jurisdiction: z.literal("CA"),
  province: gstHstProvinceSchema,
  municipality: z.string().optional(),
  constructionCosts: z.number(),
  unitCount: z.number(),
  unitType: propertyTypeSchema,
  gstHstRegistered: z.boolean(),
  devChargeRatePerUnit: z.number().optional(),
});

export type GstHstDevChargesInput = z.infer<typeof gstHstDevChargesInputSchema>;

// ============================================================================
// E53: Passive Activity Loss
// (field names mix snake_case and camelCase deliberately — see taxTypes.ts:
// these mirror the spec's literal input/output contract keys)
// ============================================================================

const passiveActivityLossPropertyForSaleSchema = z.object({
  description: z.string(),
  realizedGain: z.number(),
  usableAgainstSuspendedLoss: z.number().optional(),
});

export const passiveActivityLossInputSchema = z.object({
  jurisdiction: z.literal("US"),
  state: z.string(),
  materially_participates: z.boolean(),
  real_estate_professional: z.boolean(),
  rentalsFromE46: z.number(),
  passiveIncomeOtherSources: z.number().optional(),
  suspendedLossCarryforward: z.number().optional(),
  agiFederal: z.number().optional(),
  propertiesForSaleThisYear: z.array(passiveActivityLossPropertyForSaleSchema).optional(),
  capitalGainsTaxRate: z.number().optional(),
  incomeTaxRate: z.number().optional(),
});

export type PassiveActivityLossInput = z.infer<typeof passiveActivityLossInputSchema>;
