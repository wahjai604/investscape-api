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
import {
  calculateNOI,
  calculateDSCR,
  calculateCapRate,
  calculateCashOnCash,
  calculateDealGrade,
} from "@investscape/calc-engine";
import {
  dscrInputSchema,
  type DSCROutput,
  capRateInputSchema,
  type CapRateOutput,
  cashOnCashInputSchema,
  type CashOnCashOutput,
  dealGradeInputSchema,
  type DealGradeOutput,
  noiOutputSchema,
} from "../validation/schemas.js";

const router = Router();

/**
 * POST /calculate/dscr
 * Updated (Batch F): now returns {netOperatingIncome, operatingExpenses, expenseBreakdown?, dscr}
 * Previously returned just netOperatingIncome as a number.
 */
router.post("/calculate/dscr", (req, res) => {
  const parseResult = dscrInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { grossAnnualRent, vacancyRatePercent, annualOperatingExpenses, annualDebtService } = parseResult.data;

  const noiResult = calculateNOI({ grossAnnualRent, vacancyRatePercent, annualOperatingExpenses });
  const dscr = calculateDSCR({ netOperatingIncome: noiResult.netOperatingIncome, annualDebtService });

  const response: DSCROutput = {
    netOperatingIncome: noiResult.netOperatingIncome,
    operatingExpenses: noiResult.operatingExpenses,
    expenseBreakdown: noiResult.expenseBreakdown,
    dscr,
  };
  res.json(response);
});

/**
 * POST /calculate/noi
 * Standalone NOI calculation (new in Batch F)
 * Returns: {netOperatingIncome, operatingExpenses, expenseBreakdown?}
 */
router.post("/calculate/noi", (req, res) => {
  const parseResult = dscrInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { grossAnnualRent, vacancyRatePercent, annualOperatingExpenses } = parseResult.data;

  const noiResult = calculateNOI({ grossAnnualRent, vacancyRatePercent, annualOperatingExpenses });

  const response = noiOutputSchema.parse(noiResult);
  res.json(response);
});

/**
 * POST /calculate/cap-rate
 * Cap Rate calculation (new in Batch F)
 * Input: {noi, purchasePrice}
 * Output: {capRate}
 */
router.post("/calculate/cap-rate", (req, res) => {
  const parseResult = capRateInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { noi, purchasePrice } = parseResult.data;
  const capRate = calculateCapRate(noi, purchasePrice);

  const response: CapRateOutput = { capRate };
  res.json(response);
});

/**
 * POST /calculate/cash-on-cash
 * Cash-on-Cash calculation (new in Batch F)
 * Input: {firstYearNetCashFlow, equityInvested}
 * Output: {cashOnCash}
 */
router.post("/calculate/cash-on-cash", (req, res) => {
  const parseResult = cashOnCashInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { firstYearNetCashFlow, equityInvested } = parseResult.data;
  const cashOnCash = calculateCashOnCash(firstYearNetCashFlow, equityInvested);

  const response: CashOnCashOutput = { cashOnCash };
  res.json(response);
});

/**
 * POST /calculate/deal-grade
 * Deal Grade calculation (new in Batch F, from E79)
 * Input: {capRate?, cashOnCash?, dscr?, irr?} (each nullable)
 * Output: {grade, overallScore, scoreBreakdown, fullyScored, flaggedIssues, recommendations, summary}
 */
router.post("/calculate/deal-grade", (req, res) => {
  const parseResult = dealGradeInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateDealGrade(parseResult.data);

  const response: DealGradeOutput = result;
  res.json(response);
});

export default router;
