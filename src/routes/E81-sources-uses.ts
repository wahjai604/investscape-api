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
import { sourcesUsesInputSchema, type SourcesUsesOutput } from "../validation/schemas.js";

const router = Router();

/**
 * POST /calculate/sources-uses
 * E81: Sources ≡ Uses Reconciliation (Development Studio)
 * PHASE 2A SCAFFOLD: Returns stub response — full implementation pending.
 */
router.post("/calculate/sources-uses", (req, res) => {
  const parseResult = sourcesUsesInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const response: SourcesUsesOutput = {
    status: "not yet implemented, coming Phase 2.1",
  };
  res.json(response);
});

export default router;
