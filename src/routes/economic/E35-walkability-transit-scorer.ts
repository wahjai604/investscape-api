import { Router } from "express";
import { walkabilityTransitScorer } from "@investscape/economic-engine";
import { walkabilityInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/walkability-transit", (req, res) => {
  const parseResult = walkabilityInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = walkabilityTransitScorer(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
