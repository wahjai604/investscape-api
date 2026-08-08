import { Router } from "express";
import { calculateHoldingPeriodSensitivity } from "@investscape/calc-engine";
import { holdingPeriodSensitivityInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/holding-period-sensitivity", (req, res) => {
  const parseResult = holdingPeriodSensitivityInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateHoldingPeriodSensitivity(parseResult.data);
  res.json(result);
});

export default router;
