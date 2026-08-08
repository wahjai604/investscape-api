import { Router } from "express";
import { schoolRatingEngine } from "@investscape/economic-engine";
import { schoolRatingInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/school-ratings", (req, res) => {
  const parseResult = schoolRatingInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = schoolRatingEngine(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
