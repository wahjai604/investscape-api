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

// Schemas for the dormant us-qualifier route family (E73-E77) — see
// src/routes/us-qualifier/*.ts for the "not yet registered" note.

// ============================================================================
// E73: US Mortgage Qualifying (DTI stress tiers, conforming loan limit)
// ============================================================================

const usUnderwritingPathSchema = z.enum(["manual", "automated"]);

export const usQualifyingInputSchema = z.object({
  purchasePrice: z.number(),
  downPaymentPercent: z.number(),
  contractRate: z.number(),
  amortizationYears: z.number(),
  annualPropertyTax: z.number(),
  annualHomeownersInsurance: z.number(),
  monthlyHOADues: z.number().optional(),
  otherMonthlyDebtPayments: z.number(),
  grossAnnualIncome: z.number(),
  underwritingPath: usUnderwritingPathSchema,
  creditScore: z.number(),
  reserveMonths: z.number(),
  isHighCostArea: z.boolean(),
  monthlyMortgageInsurance: z.number().optional(),
});

export type USQualifyingInput = z.infer<typeof usQualifyingInputSchema>;

// ============================================================================
// E74: FHA Mortgage Insurance Premium
// ============================================================================

export const fhaMIPInputSchema = z.object({
  loanAmount: z.number(),
  downPaymentPercent: z.number(),
  amortizationYears: z.number(),
  isHighCostArea: z.boolean(),
});

export type FHAMIPInput = z.infer<typeof fhaMIPInputSchema>;

// ============================================================================
// E75: Conventional PMI
// ============================================================================

export const conventionalPMIInputSchema = z.object({
  loanAmount: z.number(),
  downPaymentPercent: z.number(),
  creditScore: z.number(),
});

export type ConventionalPMIInput = z.infer<typeof conventionalPMIInputSchema>;

// ============================================================================
// E76: Loan-Convention DSCR (DSCR-loan sizing) — NOT E9's commercial DSCR.
// Gross monthly rent / monthly PITIA, per the "LoanConvention" naming
// discipline documented in investscape-calc-engine/src/E76-dscr-loan-sizing.ts.
// ============================================================================

export const loanConventionDSCRInputSchema = z.object({
  grossMonthlyRent: z.number(),
  monthlyPITIA: z.number(),
  minimumRatioOverride: z.number().optional(),
  lenderAllowsNoRatioProgram: z.boolean().optional(),
});

export type LoanConventionDSCRInput = z.infer<typeof loanConventionDSCRInputSchema>;

// ============================================================================
// E77: US Qualifying Rental Income (Fannie Mae 75% rule, lease-based only)
// ============================================================================

export const usQualifyingRentalIncomeInputSchema = z.object({
  grossMonthlyRent: z.number(),
  hasSignedLease: z.boolean(),
});

export type USQualifyingRentalIncomeInput = z.infer<typeof usQualifyingRentalIncomeInputSchema>;
