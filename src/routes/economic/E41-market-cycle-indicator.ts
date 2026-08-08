import { Router } from "express";
import { marketCycleIndicator } from "@investscape/economic-engine";
import { marketCycleInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/market-cycle", (req, res) => {
  const parseResult = marketCycleInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = marketCycleIndicator(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
