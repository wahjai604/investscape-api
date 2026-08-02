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
