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
  observationSeriesInputSchema,
  cagrOverSeriesInputSchema,
  rollingSeriesInputSchema,
  indexedSeriesInputSchema,
} from "../../validation/market-intelligence-schemas.js";

const router = Router();

// E62: Market Trend Analysis

router.post("/calculate/market-intelligence/period-over-period", (req, res) => {
  const parseResult = observationSeriesInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.periodOverPeriodSeries(parseResult.data.observations);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/cagr-over-series", (req, res) => {
  const parseResult = cagrOverSeriesInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.cagrOverSeries(parseResult.data.observations, parseResult.data.years);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/rolling-mean", (req, res) => {
  const parseResult = rollingSeriesInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.rollingMeanOverSeries(parseResult.data.observations, parseResult.data.window);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/rolling-growth", (req, res) => {
  const parseResult = rollingSeriesInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.rollingGrowthOverSeries(parseResult.data.observations, parseResult.data.window);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/indexed-series", (req, res) => {
  const parseResult = indexedSeriesInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.indexedObservationSeries(parseResult.data.observations, parseResult.data.baseValue);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
