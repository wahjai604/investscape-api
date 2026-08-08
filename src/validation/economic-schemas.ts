import { z } from "zod";

const asOfDateSchema = z.coerce.date().optional();

// ============================================================================
// E29: Regional Macro Context
// ============================================================================

export const regionalMacroInputSchema = z.object({
  regionId: z.string().min(1),
  regionName: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type RegionalMacroInput = z.infer<typeof regionalMacroInputSchema>;

// ============================================================================
// E30: City Market Analysis
// ============================================================================

export const cityMarketInputSchema = z.object({
  cityId: z.string().min(1),
  cityName: z.string().min(1),
  province: z.string().min(1),
  regionId: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type CityMarketInput = z.infer<typeof cityMarketInputSchema>;

// ============================================================================
// E31: Neighborhood Demographics
// ============================================================================

export const neighborhoodDemographicsInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  coordinates: z.object({ lat: z.number(), lng: z.number() }),
  asOfDate: asOfDateSchema,
});

export type NeighborhoodDemographicsInput = z.infer<typeof neighborhoodDemographicsInputSchema>;

// ============================================================================
// E32: Comparable Sales Analysis
// ============================================================================

export const comparableSalesInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  propertyType: z.enum(["SFH", "CONDO", "MFH"]),
  asOfDate: asOfDateSchema,
});

export type ComparableSalesInput = z.infer<typeof comparableSalesInputSchema>;

// ============================================================================
// E33: Rental Comp Engine
// ============================================================================

export const rentalCompInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  propertyType: z.enum(["SFH_RENTAL", "CONDO_RENTAL", "MFH_RENTAL"]),
  asOfDate: asOfDateSchema,
});

export type RentalCompInput = z.infer<typeof rentalCompInputSchema>;

// ============================================================================
// E34: School Rating Engine
// ============================================================================

export const schoolRatingInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type SchoolRatingInput = z.infer<typeof schoolRatingInputSchema>;

// ============================================================================
// E35: Walkability & Transit Scorer
// ============================================================================

export const walkabilityInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type WalkabilityInput = z.infer<typeof walkabilityInputSchema>;

// ============================================================================
// E37: Market Velocity Analyzer
// ============================================================================

export const marketVelocityInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type MarketVelocityInput = z.infer<typeof marketVelocityInputSchema>;

// ============================================================================
// E38: Macro-Micro Sensitivity
// ============================================================================

export const macroMicroSensitivityInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  regionId: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type MacroMicroSensitivityInput = z.infer<typeof macroMicroSensitivityInputSchema>;

// ============================================================================
// E39: Mortgage Rate Forecast
// ============================================================================

export const mortgageRateForecastInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  regionId: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type MortgageRateForecastInput = z.infer<typeof mortgageRateForecastInputSchema>;

// ============================================================================
// E40: Appreciation Probability
// ============================================================================

export const appreciationProbabilityInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  regionId: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type AppreciationProbabilityInput = z.infer<typeof appreciationProbabilityInputSchema>;

// ============================================================================
// E41: Market Cycle Indicator
// ============================================================================

export const marketCycleInputSchema = z.object({
  neighborhoodId: z.string().min(1),
  neighborhoodName: z.string().min(1),
  cityId: z.string().min(1),
  regionId: z.string().min(1),
  asOfDate: asOfDateSchema,
});

export type MarketCycleInput = z.infer<typeof marketCycleInputSchema>;

// ============================================================================
// E42: Neighborhood Investment Score
// (pure computation engine — no mock lookup, no asOfDate; nullable inputs
// from E29-E37 with neutral fallbacks. E36 crime-safety is deliberately not
// part of this input shape.)
// ============================================================================

const capRateRangeSchema = z.object({ low: z.number(), high: z.number() });

export const neighborhoodInvestmentScoreInputSchema = z.object({
  gdpGrowth: z.number().nullable(),
  inflationRate: z.number().nullable(),
  unemploymentRate: z.number().nullable(),
  cityPriceTrend: z.number().nullable(),
  cityCapRateMedian: z.number().nullable(),
  cityCapRateRange: capRateRangeSchema.nullable(),
  rentalTrendCity: z.number().nullable(),
  populationGrowth: z.number().nullable(),
  medianHouseholdIncome: z.number().nullable(),
  populationDensity: z.number().nullable(),
  medianSoldPrice: z.number().nullable(),
  pricePerSqft: z.number().nullable(),
  daysOnMarket: z.number().nullable(),
  soldVolume12m: z.number().nullable(),
  priceVolatility: z.number().nullable(),
  medianRent: z.number().nullable(),
  rentPerSqft: z.number().nullable(),
  rentalVacancyRate: z.number().nullable(),
  averageSchoolRating: z.number().nullable(),
  walkScore: z.number().nullable(),
  transitScore: z.number().nullable(),
  bikeScore: z.number().nullable(),
  absorptionRate: z.number().nullable(),
  buyerCompetitionIndex: z.number().nullable(),
  regionId: z.string(),
});

export type NeighborhoodInvestmentScoreInput = z.infer<typeof neighborhoodInvestmentScoreInputSchema>;

// ============================================================================
// E43: Portfolio Geographic Diversification
// (pure computation engine — no mock data store)
// ============================================================================

const diversificationPropertySchema = z.object({
  propertyId: z.string(),
  address: z.string(),
  regionId: z.string(),
  cityId: z.string(),
  neighborhoodId: z.string(),
  propertyType: z.enum(["residential", "commercial", "development"]),
  purchasePrice: z.number(),
  currentMarketValue: z.number(),
  annualGrossIncome: z.number().nullable(),
  mortgageBalance: z.number().nullable(),
  equityValue: z.number(),
  currency: z.enum(["CAD", "USD"]),
  country: z.enum(["CA", "US"]),
});

export const portfolioDiversificationInputSchema = z.object({
  properties: z.array(diversificationPropertySchema),
  portfolioBaseCurrency: z.enum(["CAD", "USD"]),
  fxRate: z.number(),
});

export type PortfolioDiversificationInput = z.infer<typeof portfolioDiversificationInputSchema>;

// ============================================================================
// E44: Currency Risk Exposure
// (pure computation engine — no mock data store)
// ============================================================================

const currencyPropertySchema = z.object({
  propertyId: z.string(),
  currentMarketValue: z.number(),
  annualGrossIncome: z.number().nullable(),
  mortgageBalance: z.number().nullable(),
  currency: z.enum(["CAD", "USD"]),
  country: z.enum(["CA", "US"]),
});

const fxScenarioInputSchema = z.object({
  baseRate: z.number(),
  rateChange: z.number(),
  volatility: z.number().nullable(),
});

const hedgeSchema = z.object({
  hedgeId: z.string(),
  hedgeType: z.enum(["forward", "option", "loan", "other"]),
  coveredAmount: z.number(),
  effectiveRate: z.number(),
  expiryYears: z.number(),
  costPercent: z.number(),
});

export const currencyRiskExposureInputSchema = z.object({
  properties: z.array(currencyPropertySchema),
  portfolioBaseCurrency: z.enum(["CAD", "USD"]),
  fxScenarios: fxScenarioInputSchema,
  hedges: z.array(hedgeSchema),
});

export type CurrencyRiskExposureInput = z.infer<typeof currencyRiskExposureInputSchema>;

// ============================================================================
// E45: Scenario Batch Processor (capstone)
// (pure computation engine — no mock data store; internally calls E43/E44)
// ============================================================================

const scenarioVariableSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.string(),
});

const marketScenarioSchema = z.object({
  scenarioName: z.string(),
  scenarioId: z.string(),
  variables: z.array(scenarioVariableSchema),
  probability: z.number().nullable(),
  description: z.string().nullable(),
});

const propertyWithInputsSchema = z.object({
  propertyId: z.string(),
  purchasePrice: z.number(),
  downPaymentPercent: z.number(),
  interestRate: z.number(),
  amortizationYears: z.number(),
  holdingPeriodYears: z.number(),
  monthlyRentalIncome: z.number(),
  annualPropertyTaxes: z.number(),
  monthlyUtilities: z.number(),
  monthlyMaintenance: z.number(),
  monthlyPropertyManagement: z.number(),
  monthlyInsurance: z.number(),
  monthlyHOA: z.number(),
  vacancyRate: z.number(),
  sellingCost: z.number().nullable(),
  currency: z.enum(["CAD", "USD"]),
  country: z.enum(["CA", "US"]),
  mortgageCompounding: z.enum(["semi-annual", "monthly"]),
  regionId: z.string().nullable(),
  cityId: z.string().nullable(),
  neighborhoodId: z.string().nullable(),
  E42_investmentScore: z.number().nullable(),
});

export const scenarioBatchInputSchema = z.object({
  properties: z.array(propertyWithInputsSchema).min(1),
  scenarios: z.array(marketScenarioSchema).min(1),
  portfolioBaseCurrency: z.enum(["CAD", "USD"]),
  fxRate: z.number(),
  timeHorizonOverride: z.number().nullable(),
});

export type ScenarioBatchInput = z.infer<typeof scenarioBatchInputSchema>;
