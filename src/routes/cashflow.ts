import { Router } from "express";
import { projectCashFlows } from "investscape-calc-engine";
import { cashFlowInputSchema, type CashFlowOutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/cashflow", (req, res) => {
  const parseResult = cashFlowInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const data = parseResult.data;

  const baseInput = {
    holdPeriodYears: data.holdPeriodYears,
    grossAnnualRent: data.grossAnnualRent,
    vacancyRatePercent: data.vacancyRatePercent,
    annualOperatingExpenses: data.annualOperatingExpenses,
    rentGrowthRate: data.rentGrowthRate,
    expenseGrowthRate: data.expenseGrowthRate,
  };

  const cashFlowInput =
    data.debtServiceMode === "flat"
      ? { ...baseInput, annualDebtService: data.annualDebtService }
      : { ...baseInput, loan: data.loan, country: data.country };

  const result = projectCashFlows(cashFlowInput);

  const response: CashFlowOutput = result;
  res.json(response);
});

export default router;
