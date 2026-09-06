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
  fetchRegionObservationsInputSchema,
  fetchCityObservationsInputSchema,
  fetchNeighborhoodObservationsInputSchema,
} from "../../validation/market-intelligence-schemas.js";

const router = Router();

// E65: Economic Engine Data Adapter — normalizes E29/E30/E31's bundles into
// MarketObservation[] + DataQualityInputs. Input shapes are identical to
// RegionMetricsInput/CityMetricsInput/NeighborhoodMetricsInput.

router.post("/calculate/market-intelligence/region-observations", (req, res) => {
  const parseResult = fetchRegionObservationsInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.fetchRegionObservations(parseResult.data.input, parseResult.data.now);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/city-observations", (req, res) => {
  const parseResult = fetchCityObservationsInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.fetchCityObservations(parseResult.data.input, parseResult.data.now);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/neighborhood-observations", (req, res) => {
  const parseResult = fetchNeighborhoodObservationsInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.fetchNeighborhoodObservations(parseResult.data.input, parseResult.data.now);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
