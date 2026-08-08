import { Router } from "express";
import { calculateLenderScorecard } from "@investscape/calc-engine";
import { lenderScorecardInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/lender-scorecard", (req, res) => {
  const parseResult = lenderScorecardInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateLenderScorecard(parseResult.data);
  res.json(result);
});

export default router;
