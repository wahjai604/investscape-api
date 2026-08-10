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

// Financial engines (E1-E27) — existing 8
import mortgageRouter from "./E1-mortgage.js";
import exitRouter from "./E4-exit.js";
import qualifyRouter from "./E6-qualifying.js";
import dscrRouter from "./E9-dscr.js";
import cashflowRouter from "./E3-cashflow.js";
import returnsRouter from "./E5-returns.js";
import capitalstackRouter from "./E8-capitalstack.js";
import portfolioRouter from "./E10-portfolio.js";

// Financial engines (E1-E27) — new 19
import amortizationRouter from "./E2-amortization.js";
import cmhcRouter from "./E7-cmhc.js";
import pttRouter from "./E11-ptt.js";
import breakEvenRouter from "./E12-break-even.js";
import appreciationRouter from "./E13-appreciation.js";
import refinanceRouter from "./E14-refinance.js";
import scenarioRouter from "./E15-scenario.js";
import brrrrRouter from "./E16-brrrr.js";
import holdingPeriodSensitivityRouter from "./E17-holding-period-sensitivity.js";
import taxOptimizationRouter from "./E18-tax-optimization.js";
import dataProvenanceRouter from "./E19-data-provenance.js";
import fxConversionRouter from "./E20-fx-conversion.js";
import rentalWaterfallRouter from "./E21-rental-waterfall.js";
import propertyTaxRouter from "./E22-property-tax.js";
import opexBenchmarkRouter from "./E23-opex-benchmark.js";
import insuranceEstimationRouter from "./E24-insurance-estimation.js";
import lenderScorecardRouter from "./E25-lender-scorecard.js";
import amortizationDisplayRouter from "./E26-amortization-display.js";
import chartDataRouter from "./E27-chart-data.js";
import salesAppreciationRouter from "./E28-Sales-Appreciation.js";

// Economic engines (E29-E45, excluding E36)
import regionalMacroRouter from "./E29-regional-macro-context.js";
import cityMarketRouter from "./E30-city-market-analysis.js";
import neighborhoodDemographicsRouter from "./E31-neighborhood-demographics.js";
import comparableSalesRouter from "./E32-comparable-sales-analysis.js";
import rentalCompsRouter from "./E33-rental-comp-engine.js";
import schoolRatingsRouter from "./E34-school-rating-engine.js";
import walkabilityTransitRouter from "./E35-walkability-transit-scorer.js";
import marketVelocityRouter from "./E37-market-velocity-analyzer.js";
import macroMicroSensitivityRouter from "./E38-macro-micro-sensitivity.js";
import mortgageRateForecastRouter from "./E39-mortgage-rate-forecast.js";
import appreciationProbabilityRouter from "./E40-appreciation-probability.js";
import marketCycleRouter from "./E41-market-cycle-indicator.js";
import neighborhoodInvestmentScoreRouter from "./E42-neighborhood-investment-score.js";
import portfolioGeoDiversificationRouter from "./E43-portfolio-geographic-diversification.js";
import currencyRiskRouter from "./E44-currency-risk-exposure.js";
import scenarioBatchRouter from "./E45-scenario-batch-processor.js";

// Tax engines (E46-E53)
import taxAggregationRouter from "./E46-tax-aggregation.js";
import personalIncomeTaxRouter from "./E47-personal-income-tax.js";
import depreciationRouter from "./E48-depreciation.js";
import mortgageInterestRouter from "./E49-mortgage-interest.js";
import operatingExpenseRouter from "./E50-operating-expense.js";
import developerProfitRouter from "./E51-developer-profit.js";
import gstHstDevChargesRouter from "./E52-gst-hst-dev-charges.js";
import passiveActivityLossRouter from "./E53-passive-activity-loss.js";

const router = Router();

// Financial, Economic & Tax (28 + 16 + 8 = 52 engines: E1-E28, E29-E45, E46-E53; E36 excluded)
// Financial (28 engines: E1-E28)
router.use(mortgageRouter);
router.use(amortizationRouter);
router.use(cashflowRouter);
router.use(exitRouter);
router.use(returnsRouter);
router.use(qualifyRouter);
router.use(cmhcRouter);
router.use(capitalstackRouter);
router.use(dscrRouter);
router.use(portfolioRouter);
router.use(pttRouter);
router.use(breakEvenRouter);
router.use(appreciationRouter);
router.use(refinanceRouter);
router.use(scenarioRouter);
router.use(brrrrRouter);
router.use(holdingPeriodSensitivityRouter);
router.use(taxOptimizationRouter);
router.use(dataProvenanceRouter);
router.use(fxConversionRouter);
router.use(rentalWaterfallRouter);
router.use(propertyTaxRouter);
router.use(opexBenchmarkRouter);
router.use(insuranceEstimationRouter);
router.use(lenderScorecardRouter);
router.use(amortizationDisplayRouter);
router.use(chartDataRouter);
router.use(salesAppreciationRouter);

// Economic (16 engines: E29-E35, E37-E45; E36 excluded pending legal review)
router.use(regionalMacroRouter);
router.use(cityMarketRouter);
router.use(neighborhoodDemographicsRouter);
router.use(comparableSalesRouter);
router.use(rentalCompsRouter);
router.use(schoolRatingsRouter);
router.use(walkabilityTransitRouter);
router.use(marketVelocityRouter);
router.use(macroMicroSensitivityRouter);
router.use(mortgageRateForecastRouter);
router.use(appreciationProbabilityRouter);
router.use(marketCycleRouter);
router.use(neighborhoodInvestmentScoreRouter);
router.use(portfolioGeoDiversificationRouter);
router.use(currencyRiskRouter);
router.use(scenarioBatchRouter);

// Tax (8 engines: E46-E53)
router.use(taxAggregationRouter);
router.use(personalIncomeTaxRouter);
router.use(depreciationRouter);
router.use(mortgageInterestRouter);
router.use(operatingExpenseRouter);
router.use(developerProfitRouter);
router.use(gstHstDevChargesRouter);
router.use(passiveActivityLossRouter);

export default router;
