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
import mortgageRouter from "./mortgage.js";
import exitRouter from "./exit.js";
import qualifyRouter from "./qualify.js";
import dscrRouter from "./dscr.js";
import cashflowRouter from "./cashflow.js";
import returnsRouter from "./returns.js";
import capitalstackRouter from "./capitalstack.js";
import portfolioRouter from "./portfolio.js";

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

// Economic engines (E29-E45, excluding E36)
import regionalMacroRouter from "./economic/E29-regional-macro-context.js";
import cityMarketRouter from "./economic/E30-city-market-analysis.js";
import neighborhoodDemographicsRouter from "./economic/E31-neighborhood-demographics.js";
import comparableSalesRouter from "./economic/E32-comparable-sales-analysis.js";
import rentalCompsRouter from "./economic/E33-rental-comp-engine.js";
import schoolRatingsRouter from "./economic/E34-school-rating-engine.js";
import walkabilityTransitRouter from "./economic/E35-walkability-transit-scorer.js";
import marketVelocityRouter from "./economic/E37-market-velocity-analyzer.js";
import macroMicroSensitivityRouter from "./economic/E38-macro-micro-sensitivity.js";
import mortgageRateForecastRouter from "./economic/E39-mortgage-rate-forecast.js";
import appreciationProbabilityRouter from "./economic/E40-appreciation-probability.js";
import marketCycleRouter from "./economic/E41-market-cycle-indicator.js";
import neighborhoodInvestmentScoreRouter from "./economic/E42-neighborhood-investment-score.js";
import portfolioGeoDiversificationRouter from "./economic/E43-portfolio-geographic-diversification.js";
import currencyRiskRouter from "./economic/E44-currency-risk-exposure.js";
import scenarioBatchRouter from "./economic/E45-scenario-batch-processor.js";

const router = Router();

// Financial (27 engines: E1-E27)
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

export default router;
