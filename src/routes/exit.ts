import { Router } from "express";
import { calculateExitProceeds } from "@investscape/calc-engine";
import { exitProceedsInputSchema, type ExitProceedsOutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/exit", (req, res) => {
  const parseResult = exitProceedsInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const data = parseResult.data;

  const loan = {
    purchasePrice: data.loan.purchasePrice,
    downPaymentPercent: data.loan.downPaymentPercent,
    annualInterestRate: data.loan.contractRate,
    amortizationYears: data.loan.amortizationYears,
  };

  // calculateExitProceeds only reads .noi (final year) and .netCashFlow (every
  // year) off each projection row; the other YearlyCashFlow fields are
  // zero-filled placeholders so the shape satisfies the engine's type.
  const projection = data.projection.map((row) => ({
    year: row.year,
    grossRent: 0,
    vacancyAllowance: 0,
    operatingExpenses: 0,
    noi: row.noi,
    debtService: 0,
    netCashFlow: row.netCashFlow,
  }));

  const baseInput = {
    sellingCostsRate: data.sellingCostsRate,
    loan,
    country: data.country,
    holdPeriodYears: data.holdPeriodYears,
    equityInvested: data.equityInvested,
    projection,
  };

  const exitInput =
    data.method === "flat_growth"
      ? {
          ...baseInput,
          method: "flat_growth" as const,
          originalPurchasePrice: data.originalPurchasePrice,
          appreciationRate: data.appreciationRate,
        }
      : {
          ...baseInput,
          method: "cap_rate" as const,
          exitCapRate: data.exitCapRate,
        };

  const result = calculateExitProceeds(exitInput);

  const response: ExitProceedsOutput = {
    salePrice: result.salePrice,
    sellingCosts: result.sellingCosts,
    remainingLoanBalance: result.remainingLoanBalance,
    netSaleProceeds: result.netSaleProceeds,
    fullCycleIRR: result.fullCycleIRR,
  };

  res.json(response);
});

export default router;
