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
import { rollupPortfolio } from "@investscape/calc-engine";
import { portfolioInputSchema, type PortfolioOutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/portfolio", (req, res) => {
  const parseResult = portfolioInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { properties, irrGuess } = parseResult.data;

  const result = irrGuess === undefined ? rollupPortfolio(properties) : rollupPortfolio(properties, irrGuess);

  const response: PortfolioOutput = result;
  res.json(response);
});

export default router;
