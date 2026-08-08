import { Router } from "express";
import { calculateBRRRR } from "@investscape/calc-engine";
import { brrrrInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/brrrr", (req, res) => {
  const parseResult = brrrrInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateBRRRR(parseResult.data);
  res.json(result);
});

export default router;
