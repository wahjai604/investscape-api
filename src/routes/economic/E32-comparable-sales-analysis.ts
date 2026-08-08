import { Router } from "express";
import { comparableSalesAnalysis } from "@investscape/economic-engine";
import { comparableSalesInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/comparable-sales", (req, res) => {
  const parseResult = comparableSalesInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = comparableSalesAnalysis(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
