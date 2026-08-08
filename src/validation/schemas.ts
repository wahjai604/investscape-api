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

export const mortgageInputSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  contractRate: z.number().positive(),
  amortizationYears: z.number().positive(),
});

export type MortgageInput = z.infer<typeof mortgageInputSchema>;

export const mortgageOutputSchema = z.object({
  monthlyPayment: z.number(),
  qualifyingRate: z.number(),
});

export type MortgageOutput = z.infer<typeof mortgageOutputSchema>;

const exitLoanSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  contractRate: z.number().positive(),
  amortizationYears: z.number().positive(),
});

const exitProjectionRowSchema = z.object({
  year: z.number().int().positive(),
  noi: z.number(),
  netCashFlow: z.number(),
});

const exitProceedsBaseSchema = z.object({
  sellingCostsRate: z.number().min(0).max(1),
  holdPeriodYears: z.number().positive(),
  equityInvested: z.number().positive(),
  loan: exitLoanSchema,
  country: z.enum(["Canada", "US"]),
  projection: z.array(exitProjectionRowSchema).min(1),
});

export const exitProceedsInputSchema = z.discriminatedUnion("method", [
  exitProceedsBaseSchema.extend({
    method: z.literal("flat_growth"),
    originalPurchasePrice: z.number().positive(),
    appreciationRate: z.number(),
  }),
  exitProceedsBaseSchema.extend({
    method: z.literal("cap_rate"),
    exitCapRate: z.number().positive(),
  }),
]);

export type ExitProceedsInput = z.infer<typeof exitProceedsInputSchema>;

export const exitProceedsOutputSchema = z.object({
  salePrice: z.number(),
  sellingCosts: z.number(),
  remainingLoanBalance: z.number(),
  netSaleProceeds: z.number(),
  fullCycleIRR: z.number(),
});

export type ExitProceedsOutput = z.infer<typeof exitProceedsOutputSchema>;

export const qualifyInputSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  contractRate: z.number().positive(),
  amortizationYears: z.number().positive(),
  annualPropertyTax: z.number().nonnegative(),
  annualHeatingCost: z.number().nonnegative(),
  monthlyCondoFees: z.number().nonnegative().optional(),
  otherMonthlyDebtPayments: z.number().nonnegative(),
  grossAnnualIncome: z.number().positive(),
});

export type QualifyInput = z.infer<typeof qualifyInputSchema>;

export const qualifyOutputSchema = z.object({
  qualifyingRate: z.number(),
  monthlyMortgagePayment: z.number(),
  gdsRatio: z.number(),
  tdsRatio: z.number(),
  gdsPass: z.boolean(),
  tdsPass: z.boolean(),
  qualifies: z.boolean(),
});

export type QualifyOutput = z.infer<typeof qualifyOutputSchema>;

export const dscrInputSchema = z.object({
  grossAnnualRent: z.number().positive(),
  vacancyRatePercent: z.number().min(0).max(1),
  annualOperatingExpenses: z.number().nonnegative(),
  annualDebtService: z.number().positive(),
});

export type DSCRInput = z.infer<typeof dscrInputSchema>;

export const dscrOutputSchema = z.object({
  netOperatingIncome: z.number(),
  dscr: z.number(),
});

export type DSCROutput = z.infer<typeof dscrOutputSchema>;

const cashFlowLoanSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  annualInterestRate: z.number().positive(),
  amortizationYears: z.number().positive(),
});

const cashFlowBaseSchema = z.object({
  holdPeriodYears: z.number().positive(),
  grossAnnualRent: z.number().positive(),
  vacancyRatePercent: z.number().min(0).max(1),
  annualOperatingExpenses: z.number().nonnegative(),
  rentGrowthRate: z.number(),
  expenseGrowthRate: z.number(),
});

export const cashFlowInputSchema = z.discriminatedUnion("debtServiceMode", [
  cashFlowBaseSchema.extend({
    debtServiceMode: z.literal("flat"),
    annualDebtService: z.number().positive(),
  }),
  cashFlowBaseSchema.extend({
    debtServiceMode: z.literal("real"),
    loan: cashFlowLoanSchema,
    country: z.enum(["Canada", "US"]),
  }),
]);

export type CashFlowInput = z.infer<typeof cashFlowInputSchema>;

const yearlyCashFlowSchema = z.object({
  year: z.number(),
  grossRent: z.number(),
  vacancyAllowance: z.number(),
  operatingExpenses: z.number(),
  noi: z.number(),
  debtService: z.number(),
  interestPaid: z.number().optional(),
  principalPaid: z.number().optional(),
  netCashFlow: z.number(),
});

export const cashFlowOutputSchema = z.array(yearlyCashFlowSchema);

export type CashFlowOutput = z.infer<typeof cashFlowOutputSchema>;

export const returnsInputSchema = z.object({
  cashFlowSeries: z.array(z.number()).min(2),
  equityInvested: z.number().positive(),
  financeRate: z.number(),
  reinvestRate: z.number(),
  guess: z.number().optional(),
});

export type ReturnsInput = z.infer<typeof returnsInputSchema>;

export const returnsOutputSchema = z.object({
  irr: z.number(),
  mirr: z.number(),
  equityMultiple: z.number(),
});

export type ReturnsOutput = z.infer<typeof returnsOutputSchema>;

const trancheSchema = z.object({
  type: z.enum(["senior_debt", "mezzanine", "equity"]),
  amount: z.number().positive(),
  rate: z.number(),
});

export const capitalStackInputSchema = z.object({
  tranches: z.array(trancheSchema).min(1),
});

export type CapitalStackInput = z.infer<typeof capitalStackInputSchema>;

const trancheResultSchema = trancheSchema.extend({
  interestCost: z.number(),
  capitalWeight: z.number(),
});

export const capitalStackOutputSchema = z.object({
  tranches: z.array(trancheResultSchema),
  totalCapital: z.number(),
  totalDebtService: z.number(),
  weightedAverageCost: z.number(),
});

export type CapitalStackOutput = z.infer<typeof capitalStackOutputSchema>;

const propertyPositionSchema = z.object({
  name: z.string().min(1),
  equityInvested: z.number().positive(),
  cashFlowSeries: z.array(z.number()).min(1),
  annualNetCashFlow: z.number(),
  dscr: z.number(),
  propertyValue: z.number().positive(),
});

export const portfolioInputSchema = z.object({
  properties: z.array(propertyPositionSchema).min(1),
  irrGuess: z.number().optional(),
});

export type PortfolioInput = z.infer<typeof portfolioInputSchema>;

const propertyIRRDetailSchema = z.object({
  name: z.string(),
  individualIRR: z.number(),
});

const concentrationRiskSchema = z.object({
  name: z.string(),
  propertyValue: z.number(),
  percentOfPortfolio: z.number(),
});

export const portfolioOutputSchema = z.object({
  totalEquityInvested: z.number(),
  pooledPortfolioIRR: z.number(),
  propertyIRRs: z.array(propertyIRRDetailSchema),
  totalAnnualNetCashFlow: z.number(),
  portfolioDSCRFloor: z.number(),
  totalPortfolioValue: z.number(),
  concentrationRisk: z.array(concentrationRiskSchema),
});

export type PortfolioOutput = z.infer<typeof portfolioOutputSchema>;

// ============================================================================
// E2: Amortization
// ============================================================================

const loanInputSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  annualInterestRate: z.number().positive(),
  amortizationYears: z.number().positive(),
});

const mortgageCountrySchema = z.enum(["Canada", "US"]);

export const amortizationInputSchema = z.object({
  loan: loanInputSchema,
  country: mortgageCountrySchema,
  months: z.number().int().positive(),
});

export type AmortizationInput = z.infer<typeof amortizationInputSchema>;

// ============================================================================
// E7: CMHC Premium
// ============================================================================

export const cmhcInputSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  amortizationYears: z.number().positive(),
});

export type CMHCInput = z.infer<typeof cmhcInputSchema>;

// ============================================================================
// E11: PTT (Property Transfer Tax)
// ============================================================================

export const pttInputSchema = z.object({
  purchasePrice: z.number().positive(),
  country: z.enum(["Canada", "US"]),
  province: z.string(),
  isFTHB: z.boolean(),
  fmv: z.number().positive(),
  propertySize_hectares: z.number().nonnegative(),
  hasSecondaryBuilding: z.boolean(),
  isPrincipalResidence: z.boolean(),
});

export type PTTInput = z.infer<typeof pttInputSchema>;

// ============================================================================
// E12: Break-Even
// ============================================================================

export const breakEvenInputSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  annualInterestRate: z.number().positive(),
  amortizationYears: z.number().positive(),
  country: mortgageCountrySchema,
  monthlyRent: z.number().nonnegative(),
  vacancyMonths: z.number().min(0).max(12),
  propertyTaxAnnual: z.number().nonnegative(),
  insuranceAnnual: z.number().nonnegative(),
  maintenanceAnnual: z.number().nonnegative(),
  propertyMgmtFeePercent: z.number().min(0).max(1),
  strataFeeAnnual: z.number().nonnegative(),
  mode: z.enum(["down_payment", "monthly_payment"]).optional(),
});

export type BreakEvenInput = z.infer<typeof breakEvenInputSchema>;

// ============================================================================
// E13: Appreciation
// ============================================================================

export const appreciationInputSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  initialEquity: z.number().nonnegative(),
  holdPeriodYears: z.number().positive(),
  annualAppreciationRate: z.number(),
  closingCostsPercent: z.number().min(0).max(1).optional(),
  remainingLoanBalance: z.number().nonnegative(),
});

export type AppreciationInput = z.infer<typeof appreciationInputSchema>;

// ============================================================================
// E14: Refinance
// ============================================================================

export const refinanceInputSchema = z.object({
  currentLoanAmount: z.number().positive(),
  currentInterestRate: z.number().positive(),
  currentAmortizationRemaining: z.number().positive(),
  newInterestRate: z.number().positive(),
  newAmortizationYears: z.number().positive(),
  refinancingCostsPercent: z.number().min(0).max(1).optional(),
  holdPeriodYears: z.number().positive(),
  country: mortgageCountrySchema,
  monthlyNOI: z.number(),
});

export type RefinanceInput = z.infer<typeof refinanceInputSchema>;

// ============================================================================
// E15: Scenario Comparison
// ============================================================================

const dealParametersSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  annualInterestRate: z.number().positive(),
  amortizationYears: z.number().positive(),
  country: mortgageCountrySchema,
  grossAnnualRent: z.number().positive(),
  vacancyRatePercent: z.number().min(0).max(1),
  annualOperatingExpenses: z.number().nonnegative(),
  equityInvested: z.number().positive(),
});

const scenarioAssumptionsSchema = z.object({
  name: z.string().min(1),
  rentGrowthRate: z.number(),
  expenseGrowthRate: z.number(),
  appreciationRate: z.number(),
  exitCapRate: z.number().positive().nullable(),
});

export const scenarioInputSchema = z.object({
  baseDeal: dealParametersSchema,
  scenarios: z.array(scenarioAssumptionsSchema).min(1),
  holdPeriodYears: z.number().positive(),
  sellingCostsPercent: z.number().min(0).max(1).optional(),
});

export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

// ============================================================================
// E16: BRRRR
// ============================================================================

export const brrrrInputSchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  rehab_cost: z.number().nonnegative(),
  rehab_timeline_months: z.number().nonnegative(),
  afterRepairValue: z.number().positive(),
  newMonthlyRent: z.number().positive(),
  holdPeriodBeforeRefinanceMonths: z.number().nonnegative(),
  refinanceInterestRate: z.number().positive(),
  refinanceAmortizationYears: z.number().positive(),
  country: mortgageCountrySchema,
  originalInterestRate: z.number().positive(),
  originalAmortizationYears: z.number().positive(),
  refinanceLTVPercent: z.number().min(0).max(1).optional(),
});

export type BRRRRInput = z.infer<typeof brrrrInputSchema>;

// ============================================================================
// E17: Holding Period Sensitivity
// ============================================================================

export const holdingPeriodSensitivityInputSchema = z.object({
  baseDeal: dealParametersSchema,
  rentGrowthRate: z.number(),
  expenseGrowthRate: z.number(),
  appreciationRate: z.number(),
  exitCapRate: z.number().positive().nullable(),
  sellingCostsPercent: z.number().min(0).max(1).optional(),
});

export type HoldingPeriodSensitivityInput = z.infer<typeof holdingPeriodSensitivityInputSchema>;

// ============================================================================
// E18: Tax Optimization
// ============================================================================

export const taxOptimizationInputSchema = z.object({
  purchasePrice: z.number().positive(),
  propertyType: z.enum(["residential", "commercial", "land"]),
  improvementValue: z.number().nonnegative(),
  landValue: z.number().nonnegative(),
  annualNetOperatingIncome: z.number(),
  holdPeriodYears: z.number().positive(),
  capitalGainsTaxRate: z.number().min(0).max(1),
  ordinaryIncomeRate: z.number().min(0).max(1),
  depreciationRecaptureRate: z.number().min(0).max(1),
  country: z.enum(["Canada", "US"]),
  initialEquity: z.number().positive(),
  projectedSalePrice: z.number().positive(),
  remainingLoanBalance: z.number().nonnegative(),
});

export type TaxOptimizationInput = z.infer<typeof taxOptimizationInputSchema>;

// ============================================================================
// E19: Data Provenance
// ============================================================================

const provenanceEntrySchema = z.object({
  value: z.number(),
  source: z.enum(["user_input", "market_data", "appraised", "estimated", "calculated"]),
  confidence: z.number().min(0).max(1),
  lastUpdatedDate: z.string(),
});

export const dataProvenanceInputSchema = z.object({
  purchasePrice: provenanceEntrySchema.optional(),
  downPaymentPercent: provenanceEntrySchema.optional(),
  annualInterestRate: provenanceEntrySchema.optional(),
  amortizationYears: provenanceEntrySchema.optional(),
  grossAnnualRent: provenanceEntrySchema.optional(),
  vacancyRatePercent: provenanceEntrySchema.optional(),
  annualOperatingExpenses: provenanceEntrySchema.optional(),
  equityInvested: provenanceEntrySchema.optional(),
});

export type DataProvenanceInput = z.infer<typeof dataProvenanceInputSchema>;

// ============================================================================
// E20: FX Conversion
// ============================================================================

const dealMetricsSchema = z.object({
  purchasePrice: z.number().positive(),
  annualCashFlow: z.number(),
  projectedEquity: z.number(),
  irr: z.number(),
  holdPeriodYears: z.number().positive(),
  equityInvested: z.number().positive(),
});

export const fxConversionInputSchema = z.object({
  dealMetrics: dealMetricsSchema,
  dealCurrency: z.enum(["CAD", "USD"]),
  investorCurrency: z.enum(["CAD", "USD"]),
  fxRate: z.number().positive(),
  fxRateSource: z.enum(["user_input", "market_current", "historical_average"]),
});

export type FXConversionInput = z.infer<typeof fxConversionInputSchema>;

// ============================================================================
// E21: Rental Waterfall
// ============================================================================

const rentalUnitSchema = z.object({
  unitId: z.string().min(1),
  monthlyRent: z.number().nonnegative(),
  vacancyRatePercent: z.number().min(0).max(1),
  rampStartMonth: z.number().nonnegative(),
  rampEndMonth: z.number().nonnegative().nullable(),
  occupancyDuringRamp: z.number().min(0).max(1),
});

export const rentalWaterfallInputSchema = z.object({
  units: z.array(rentalUnitSchema).min(1),
  analysisMonths: z.number().int().positive(),
});

export type RentalWaterfallInput = z.infer<typeof rentalWaterfallInputSchema>;

// ============================================================================
// E22: Property Tax
// ============================================================================

export const propertyTaxInputSchema = z.object({
  propertyValue: z.number().positive(),
  country: z.enum(["Canada", "US"]),
  province: z.string(),
  state: z.string(),
  propertyType: z.enum(["residential", "commercial", "industrial", "land"]),
  isNewConstruction: z.boolean(),
});

export type PropertyTaxInput = z.infer<typeof propertyTaxInputSchema>;

// ============================================================================
// E23: OpEx Benchmark
// ============================================================================

export const opexBenchmarkInputSchema = z.object({
  propertyType: z.enum([
    "sfh",
    "duplex",
    "triplex",
    "fourplex",
    "multifamily_5_20",
    "multifamily_20plus",
    "commercial",
    "mixed_use",
  ]),
  grossAnnualRent: z.number().positive(),
  country: z.enum(["Canada", "US"]),
  locationTier: z.enum(["urban", "suburban", "rural"]),
  includePropertyManagement: z.boolean(),
  propertyManagementPercent: z.number().min(0).max(1).optional(),
});

export type OpExBenchmarkInput = z.infer<typeof opexBenchmarkInputSchema>;

// ============================================================================
// E24: Insurance Estimation
// ============================================================================

export const insuranceEstimationInputSchema = z.object({
  propertyValue: z.number().positive(),
  propertyType: z.enum(["sfh", "duplex", "multifamily", "commercial"]),
  country: z.enum(["Canada", "US"]),
  state: z.string().optional(),
  loanToValuePercent: z.number().min(0).max(1),
  hasBeenInsured: z.boolean(),
  buildingAgeYears: z.number().nonnegative(),
});

export type InsuranceEstimationInput = z.infer<typeof insuranceEstimationInputSchema>;

// ============================================================================
// E25: Lender Scorecard
// ============================================================================

export const lenderScorecardInputSchema = z.object({
  gdsRatio: z.number().nonnegative(),
  tdsRatio: z.number().nonnegative(),
  dscrRatio: z.number().nonnegative(),
  ltvPercent: z.number().min(0).max(1),
  creditScoreEstimate: z.number().positive(),
  country: z.enum(["Canada", "US"]),
  loanType: z.enum(["conventional", "insured", "portfolio"]),
  propertyType: z.enum(["residential", "commercial", "mixed_use"]),
});

export type LenderScorecardInput = z.infer<typeof lenderScorecardInputSchema>;

// ============================================================================
// E26: Amortization Display
// ============================================================================

const displayTrancheSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["senior", "mezzanine", "equity"]),
  loanAmount: z.number().positive(),
  annualInterestRate: z.number().positive(),
  amortizationYears: z.number().positive(),
  drawDate_month: z.number().nonnegative(),
  country: mortgageCountrySchema,
});

export const amortizationDisplayInputSchema = z.object({
  tranches: z.array(displayTrancheSchema).min(1),
});

export type AmortizationDisplayInput = z.infer<typeof amortizationDisplayInputSchema>;

// ============================================================================
// E27: Chart Data
// ============================================================================

const dealSummarySchema = z.object({
  purchasePrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(1),
  holdPeriodYears: z.number().positive(),
});

const yearlyCashFlowSchemaFull = z.object({
  year: z.number(),
  grossRent: z.number(),
  vacancyAllowance: z.number(),
  operatingExpenses: z.number(),
  noi: z.number(),
  debtService: z.number(),
  interestPaid: z.number().optional(),
  principalPaid: z.number().optional(),
  netCashFlow: z.number(),
});

const displayMonthlyRowSchema = z.object({
  month: z.number(),
  beginning_balance: z.number(),
  payment: z.number(),
  principal: z.number(),
  interest: z.number(),
  ending_balance: z.number(),
});

const displayAnnualRowSchema = z.object({
  year: z.number(),
  beginning_balance: z.number(),
  annual_payment: z.number(),
  annual_principal: z.number(),
  annual_interest: z.number(),
  ending_balance: z.number(),
});

const trancheScheduleSchema = z.object({
  tranche_id: z.string(),
  type: z.enum(["senior", "mezzanine", "equity"]),
  color: z.string(),
  monthly_rows: z.array(displayMonthlyRowSchema),
  annual_summary: z.array(displayAnnualRowSchema),
  payoff_month: z.number(),
  total_interest_paid: z.number(),
});

const amortizationDisplayResultSchema = z.object({
  tranche_schedules: z.array(trancheScheduleSchema),
  combined_view: z.object({
    month_count: z.number(),
    all_tranches_zero_month: z.number(),
  }),
});

export const chartDataInputSchema = z.object({
  deal: dealSummarySchema,
  cashflowSchedule: z.array(yearlyCashFlowSchemaFull).min(1),
  amortizationDisplayResult: amortizationDisplayResultSchema,
  equityInvested: z.number().positive(),
});

export type ChartDataInput = z.infer<typeof chartDataInputSchema>;
