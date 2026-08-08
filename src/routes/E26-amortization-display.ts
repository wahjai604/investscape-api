import { Router } from "express";
import { generateAmortizationDisplay } from "@investscape/calc-engine";
import { amortizationDisplayInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/amortization-display", (req, res) => {
  const parseResult = amortizationDisplayInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = generateAmortizationDisplay(parseResult.data);
  res.json(result);
});

export default router;
