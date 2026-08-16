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

// DO NOT CONFUSE WITH the active /calculate/dscr route (src/routes/E9-dscr.ts,
// net operating income / annual debt service — the commercial convention).
// This is the DSCR-LOAN underwriting ratio (gross monthly rent / monthly
// PITIA) from investscape-calc-engine/src/E76-dscr-loan-sizing.ts. The route
// path is deliberately "loan-convention-dscr", not "dscr", for the same
// reason every export in that engine file keeps the "LoanConvention"
// qualifier — see that file's header for the full explanation.

import { Router } from "express";
import { evaluateLoanConventionDSCR } from "@investscape/calc-engine";
import { loanConventionDSCRInputSchema } from "../../validation/us-qualifier-schemas.js";

const router = Router();

router.post("/calculate/loan-convention-dscr", (req, res) => {
  const parseResult = loanConventionDSCRInputSchema.safeParse(req.body);
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
    const result = evaluateLoanConventionDSCR(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
