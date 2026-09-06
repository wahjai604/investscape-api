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
  buildNeighborhoodSnapshotInputSchema,
  benchmarkNeighborhoodMetricInputSchema,
} from "../../validation/market-intelligence-schemas.js";

const router = Router();

// E66: Neighborhood Snapshot / Orchestration Service — the routes that
// actually call through to @investscape/economic-engine (regionalMacroContext/
// cityMarketAnalysis/neighborhoodDemographics via the adapters), rather than
// operating on a caller-supplied MarketObservation[].

router.post("/calculate/market-intelligence/neighborhood-snapshot", (req, res) => {
  const parseResult = buildNeighborhoodSnapshotInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.buildNeighborhoodSnapshot(parseResult.data.input, parseResult.data.now);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/benchmark-neighborhood-metric", (req, res) => {
  const parseResult = benchmarkNeighborhoodMetricInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.benchmarkNeighborhoodMetric(
      parseResult.data.subjectInput,
      parseResult.data.peerInputs,
      parseResult.data.metricId,
      parseResult.data.now,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
