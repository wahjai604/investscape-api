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
import { calculateIRR, calculateMIRR, calculateEquityMultiple } from "@investscape/calc-engine";
import { returnsInputSchema, type ReturnsOutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/returns", (req, res) => {
  const parseResult = returnsInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { cashFlowSeries, equityInvested, financeRate, reinvestRate, guess } = parseResult.data;

  const irr = calculateIRR(cashFlowSeries, guess);
  const mirr = calculateMIRR(cashFlowSeries, financeRate, reinvestRate);
  const equityMultiple = calculateEquityMultiple(equityInvested, cashFlowSeries);

  const response: ReturnsOutput = { irr, mirr, equityMultiple };
  res.json(response);
});

export default router;
