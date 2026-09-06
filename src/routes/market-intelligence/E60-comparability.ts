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
import { marketIntelligence } from "@investscape/market-intelligence-engine";
import {
  comparabilityInputSchema,
  seriesComparabilityInputSchema,
} from "../../validation/market-intelligence-schemas.js";

const router = Router();

// E60: Comparability Validation — error envelope is { error: { message } }
// per Doc 62 §2.7's recommended shape (this is the first route family added
// since Phase 1 hardening; the 21 pre-existing locally-caught routes are not
// retrofitted).

router.post("/calculate/market-intelligence/comparability", (req, res) => {
  const parseResult = comparabilityInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.checkComparability(parseResult.data.a, parseResult.data.b);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/series-comparability", (req, res) => {
  const parseResult = seriesComparabilityInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.checkSeriesComparability(parseResult.data.reference, parseResult.data.series);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
