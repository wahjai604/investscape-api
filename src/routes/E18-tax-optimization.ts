import { Router } from "express";
import { calculateTaxOptimization } from "@investscape/calc-engine";
import { taxOptimizationInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/tax-optimization", (req, res) => {
  const parseResult = taxOptimizationInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateTaxOptimization(parseResult.data);
  res.json(result);
});

export default router;
