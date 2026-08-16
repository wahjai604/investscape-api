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

import { z } from "zod";

// Schemas for the dormant syndication-waterfall route family (E71-E72) — see
// src/routes/syndication-waterfall/syndication-waterfall.ts for the "not yet
// registered" note.

// ============================================================================
// E71: Syndication Waterfall
// ============================================================================

const lpContributionSchema = z.object({
  investorId: z.string(),
  amount: z.number(),
});

// NOTE: irrHurdle is a plain JSON number. The engine's own default tier table
// uses `Infinity` for the open-ended top tier, which has no JSON
// representation — a caller supplying a *custom* tiers array over this API
// cannot express an open-ended top tier and must supply a large finite
// number instead (e.g. 999) until/unless this is revisited. Omitting `tiers`
// entirely still gets the engine's real Infinity-based default, since that
// default lives in investscape-calc-engine, not here.
const waterfallTierSchema = z.object({
  irrHurdle: z.number(),
  lpSplit: z.number(),
  gpSplit: z.number(),
});

const waterfallCashFlowPeriodSchema = z.object({
  period: z.number(),
  distributableCash: z.number(),
});

export const syndicationWaterfallInputSchema = z.object({
  totalEquityRaised: z.number(),
  lpContributions: z.array(lpContributionSchema),
  preferredReturnRate: z.number().optional(),
  gpCatchUpPercent: z.number().optional(),
  tiers: z.array(waterfallTierSchema).optional(),
  cashFlows: z.array(waterfallCashFlowPeriodSchema),
});

export type SyndicationWaterfallInput = z.infer<typeof syndicationWaterfallInputSchema>;
