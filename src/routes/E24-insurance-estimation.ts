import { Router } from "express";
import { calculateInsuranceEstimation } from "@investscape/calc-engine";
import { insuranceEstimationInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/insurance-estimation", (req, res) => {
  const parseResult = insuranceEstimationInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateInsuranceEstimation(parseResult.data);
  res.json(result);
});

export default router;
