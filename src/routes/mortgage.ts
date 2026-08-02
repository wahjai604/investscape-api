import { Router } from "express";
import { calculateMonthlyMortgagePayment } from "investscape-calc-engine";
import { mortgageInputSchema, type MortgageOutput } from "../validation/schemas.js";

const router = Router();

// Mirrors the OSFI/FCAC stress test floor and buffer used internally by
// investscape-calc-engine's qualifyForMortgage (not exposed as a standalone export).
const MINIMUM_QUALIFYING_RATE = 0.0525;
const STRESS_TEST_BUFFER = 0.02;

router.post("/calculate/mortgage", (req, res) => {
  const parseResult = mortgageInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { purchasePrice, downPaymentPercent, contractRate, amortizationYears } = parseResult.data;

  const monthlyPayment = calculateMonthlyMortgagePayment({
    purchasePrice,
    downPaymentPercent,
    annualInterestRate: contractRate,
    amortizationYears,
  });

  const qualifyingRate = Math.max(MINIMUM_QUALIFYING_RATE, contractRate + STRESS_TEST_BUFFER);

  const response: MortgageOutput = { monthlyPayment, qualifyingRate };
  res.json(response);
});

export default router;
