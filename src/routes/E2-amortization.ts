import { Router } from "express";
import { amortizationSchedule } from "@investscape/calc-engine";
import { amortizationInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/amortization", (req, res) => {
  const parseResult = amortizationInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { loan, country, months } = parseResult.data;

  const result = amortizationSchedule(loan, country, months);
  res.json(result);
});

export default router;
