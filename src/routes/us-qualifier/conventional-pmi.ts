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

// Not yet registered in routes/index.ts - dormant until a product decision
// on auth/entitlement gating, per investscape-docs Doc 62.

import { Router } from "express";
import { calculateConventionalPMI } from "@investscape/calc-engine";
import { conventionalPMIInputSchema } from "../../validation/us-qualifier-schemas.js";

const router = Router();

router.post("/calculate/conventional-pmi", (req, res) => {
  const parseResult = conventionalPMIInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        message: parseResult.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; "),
      },
    });
    return;
  }

  try {
    // calculateConventionalPMI() returns a real 0 (not omitted) at/below
    // 80% LTV — that's a normal 200 response, not an error path.
    const result = calculateConventionalPMI(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
