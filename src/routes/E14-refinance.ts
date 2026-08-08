import { Router } from "express";
import { calculateRefinance } from "@investscape/calc-engine";
import { refinanceInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/refinance", (req, res) => {
  const parseResult = refinanceInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateRefinance(parseResult.data);
  res.json(result);
});

export default router;
