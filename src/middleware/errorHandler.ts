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

import type { NextFunction, Request, Response } from "express";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// Known 4xx raised by framework/middleware (e.g. malformed JSON from
// express.json()) carry a numeric status/statusCode; anything else is an
// unexpected engine/runtime exception and defaults to 500 rather than
// being guessed at as a client error.
function statusFor(err: unknown): number {
  const candidate = (err as { status?: unknown; statusCode?: unknown })?.status ??
    (err as { status?: unknown; statusCode?: unknown })?.statusCode;
  if (typeof candidate === "number" && candidate >= 400 && candidate < 500) {
    return candidate;
  }
  return 500;
}

// Centralized error-handling middleware. Must be mounted last, after the
// 404 handler, so it only sees errors passed via next(err) or synchronous
// throws Express forwards automatically from route handlers.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = statusFor(err);
  const message = err instanceof Error ? err.message : String(err);

  console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}:`, err);

  res.status(status).json({
    error: {
      message: status === 500 ? "Internal server error" : "Request could not be processed",
      ...(isProduction() ? {} : { detail: message }),
    },
  });
}
