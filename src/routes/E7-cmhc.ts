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
import { calculateCMHCPremium } from "@investscape/calc-engine";
import { cmhcInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/cmhc", (req, res) => {
  const parseResult = cmhcInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const cmhcPremium = calculateCMHCPremium(parseResult.data);
    res.json({ cmhcPremium });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
