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
import { qualifyForUSMortgage } from "@investscape/calc-engine";
import { usQualifyingInputSchema } from "../../validation/us-qualifier-schemas.js";

const router = Router();

router.post("/calculate/us-qualifying", (req, res) => {
  const parseResult = usQualifyingInputSchema.safeParse(req.body);
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
    // qualifyForUSMortgage() never throws — DTI-tier and conforming-limit
    // findings surface in the response's own issues[]/dtiPass/qualifies
    // fields, not as an HTTP error.
    const result = qualifyForUSMortgage(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
