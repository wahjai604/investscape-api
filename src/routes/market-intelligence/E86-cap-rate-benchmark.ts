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
import { creIntelligence } from "@investscape/market-intelligence-engine";
import { capRateBenchmarkRequestSchema } from "../../validation/market-intelligence-schemas.ts";

const router = Router();

// E86: CRE Cap-Rate Benchmark
//
// Thin pass-through to creIntelligence.getCapRateBenchmark. Response is an
// explicit allow-list DTO — provenance/citation/source/legacy-mapping fields
// from the engine's CREBenchmarkResponse are never forwarded to the client.

router.post("/market-intelligence/cre/cap-rate-benchmark", (req, res) => {
  const parseResult = capRateBenchmarkRequestSchema.safeParse(req.body);
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
    const { identity, asOf } = parseResult.data;
    const asOfDate = asOf ? new Date(asOf) : undefined;
    const result = creIntelligence.getCapRateBenchmark(identity, asOfDate);

    res.json({
      status: result.status,
      identity: result.identity,
      ...(result.publisherRange !== undefined ? { publisherRange: result.publisherRange } : {}),
      ...(result.publisherValue !== undefined ? { publisherValue: result.publisherValue } : {}),
      ...(result.derivedBenchmark !== undefined
        ? {
            derivedBenchmark: {
              value: result.derivedBenchmark.value,
              unit: result.derivedBenchmark.unit,
              derivationMethod: result.derivedBenchmark.derivationMethod,
            },
          }
        : {}),
      ...(result.qualification !== undefined ? { qualification: result.qualification } : {}),
      warnings: result.warnings,
      ...(result.dataGap !== undefined
        ? {
            dataGap: {
              reason: result.dataGap.reason,
              lastResearchDate: result.dataGap.lastResearchDate,
            },
          }
        : {}),
    });
  } catch (error) {
    res.status(400).json({ error: { message: (error as Error).message } });
  }
});

export default router;
