import { Router } from "express";
import { mortgageRateForecast } from "@investscape/economic-engine";
import { mortgageRateForecastInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/mortgage-rate-forecast", (req, res) => {
  const parseResult = mortgageRateForecastInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = mortgageRateForecast(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
