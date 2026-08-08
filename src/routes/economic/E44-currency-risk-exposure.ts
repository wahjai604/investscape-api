import { Router } from "express";
import { currencyRiskExposure } from "@investscape/economic-engine";
import { currencyRiskExposureInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/currency-risk", (req, res) => {
  const parseResult = currencyRiskExposureInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = currencyRiskExposure(parseResult.data);
  res.json(result);
});

export default router;
