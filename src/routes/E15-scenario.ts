import { Router } from "express";
import { calculateScenarioComparison } from "@investscape/calc-engine";
import { scenarioInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/scenario", (req, res) => {
  const parseResult = scenarioInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateScenarioComparison(parseResult.data);
  res.json(result);
});

export default router;
