import { Router } from "express";
import { marketVelocityAnalyzer } from "@investscape/economic-engine";
import { marketVelocityInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/market-velocity", (req, res) => {
  const parseResult = marketVelocityInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = marketVelocityAnalyzer(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
