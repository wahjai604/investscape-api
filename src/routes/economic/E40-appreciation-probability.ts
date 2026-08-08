import { Router } from "express";
import { appreciationProbability } from "@investscape/economic-engine";
import { appreciationProbabilityInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/appreciation-probability", (req, res) => {
  const parseResult = appreciationProbabilityInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = appreciationProbability(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
