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
import { calculateQualifyingRentalIncomeUS } from "@investscape/calc-engine";
import { usQualifyingRentalIncomeInputSchema } from "../../validation/us-qualifier-schemas.js";

const router = Router();

router.post("/calculate/qualifying-rental-income-us", (req, res) => {
  const parseResult = usQualifyingRentalIncomeInputSchema.safeParse(req.body);
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
    // calculateQualifyingRentalIncomeUS() never throws — it returns
    // qualifyingRentalIncome: null plus an issues[] entry when
    // hasSignedLease is false, rather than estimating without a lease.
    const result = calculateQualifyingRentalIncomeUS(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
