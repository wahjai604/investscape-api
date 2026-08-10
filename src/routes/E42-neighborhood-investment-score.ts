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
import { neighborhoodInvestmentScore } from "@investscape/economic-engine";
import { neighborhoodInvestmentScoreInputSchema } from "../validation/economic-schemas.js";

const router = Router();

// E36 (crime-safety) is deliberately excluded from this composite score
// pending legal review — the input schema below has no crime/safety field.
router.post("/calculate/neighborhood-investment-score", (req, res) => {
  const parseResult = neighborhoodInvestmentScoreInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = neighborhoodInvestmentScore(parseResult.data);
  res.json(result);
});

export default router;
