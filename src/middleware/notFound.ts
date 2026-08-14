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

import type { Request, Response } from "express";

// Mounted after all routes; anything that reaches here matched no route.
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: "Not found",
      path: req.originalUrl,
    },
  });
}
