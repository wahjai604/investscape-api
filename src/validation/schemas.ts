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
