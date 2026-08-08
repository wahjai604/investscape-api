import { Router } from "express";
import { rentalCompEngine } from "@investscape/economic-engine";
import { rentalCompInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/rental-comps", (req, res) => {
  const parseResult = rentalCompInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = rentalCompEngine(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
