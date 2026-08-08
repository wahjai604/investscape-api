import { Router } from "express";
import { neighborhoodInvestmentScore } from "@investscape/economic-engine";
import { neighborhoodInvestmentScoreInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

// E36 (crime-safety) is deliberately excluded from this composite score
// pending legal review — the input schema below has no crime/safety field.
router.post("/calculate/neighborhood-investment-score", (req, res) => {
  const parseResult = neighborhoodInvestmentScoreInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = neighborhoodInvestmentScore(parseResult.data);
  res.json(result);
});

export default router;
