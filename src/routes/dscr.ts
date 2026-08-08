import { Router } from "express";
import { calculateNOI, calculateDSCR } from "@investscape/calc-engine";
import { dscrInputSchema, type DSCROutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/dscr", (req, res) => {
  const parseResult = dscrInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { grossAnnualRent, vacancyRatePercent, annualOperatingExpenses, annualDebtService } = parseResult.data;

  const netOperatingIncome = calculateNOI({ grossAnnualRent, vacancyRatePercent, annualOperatingExpenses });
  const dscr = calculateDSCR({ netOperatingIncome, annualDebtService });

  const response: DSCROutput = { netOperatingIncome, dscr };
  res.json(response);
});

export default router;
