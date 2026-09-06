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
  wrapRegionGeographyInputSchema,
  wrapCityGeographyInputSchema,
  wrapNeighborhoodGeographyInputSchema,
  unwrapGeographyInputSchema,
  countryCodeForRegionIdInputSchema,
} from "../../validation/market-intelligence-schemas.js";

const router = Router();

// E61: Geography Reconciliation

router.post("/calculate/market-intelligence/wrap-region-geography", (req, res) => {
  const parseResult = wrapRegionGeographyInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.wrapRegionGeography(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/wrap-city-geography", (req, res) => {
  const parseResult = wrapCityGeographyInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.wrapCityGeography(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/wrap-neighborhood-geography", (req, res) => {
  const parseResult = wrapNeighborhoodGeographyInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.wrapNeighborhoodGeography(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/unwrap-geography", (req, res) => {
  const parseResult = unwrapGeographyInputSchema.safeParse(req.body);
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
    const result = marketIntelligence.unwrapEconomicEngineGeography(parseResult.data.geography);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

router.post("/calculate/market-intelligence/country-code-for-region", (req, res) => {
  const parseResult = countryCodeForRegionIdInputSchema.safeParse(req.body);
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
    const countryCode = marketIntelligence.countryCodeForRegionId(parseResult.data.regionId);
    res.json({ countryCode });
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
