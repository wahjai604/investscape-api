import { Router } from "express";
import { cityMarketAnalysis } from "@investscape/economic-engine";
import { cityMarketInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/city-market", (req, res) => {
  const parseResult = cityMarketInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = cityMarketAnalysis(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
