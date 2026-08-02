import { Router } from "express";
import { calculateIRR, calculateMIRR, calculateEquityMultiple } from "investscape-calc-engine";
import { returnsInputSchema, type ReturnsOutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/returns", (req, res) => {
  const parseResult = returnsInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { cashFlowSeries, equityInvested, financeRate, reinvestRate, guess } = parseResult.data;

  const irr = calculateIRR(cashFlowSeries, guess);
  const mirr = calculateMIRR(cashFlowSeries, financeRate, reinvestRate);
  const equityMultiple = calculateEquityMultiple(equityInvested, cashFlowSeries);

  const response: ReturnsOutput = { irr, mirr, equityMultiple };
  res.json(response);
});

export default router;
