import { Router } from "express";
import { neighborhoodDemographics } from "@investscape/economic-engine";
import { neighborhoodDemographicsInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/neighborhood-demographics", (req, res) => {
  const parseResult = neighborhoodDemographicsInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = neighborhoodDemographics(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
