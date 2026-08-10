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
import { calculateSalePrice } from "@investscape/calc-engine";
import { salePriceInputSchema, type SalePriceOutput } from "../validation/schemas.js";

const router = Router();

/**
 * E28: Sales Price Appreciation
 *
 * POST /calculate/sales-appreciation
 *
 * Calculate property sale price using either:
 * 1. Flat growth method: Compound appreciation rate over hold period
 * 2. Cap rate method: Reverse-engineer from NOI and target cap rate
 */
router.post("/calculate/sales-appreciation", (req, res) => {
  const parseResult = salePriceInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const input = parseResult.data;
  const salePrice = calculateSalePrice(input);

  const response: SalePriceOutput = { salePrice };
  res.json(response);
});

export default router;
