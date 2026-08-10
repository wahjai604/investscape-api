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

import { Router } from "express";
import { projectCashFlows } from "@investscape/calc-engine";
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
