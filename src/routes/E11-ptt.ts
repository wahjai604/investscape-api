import { Router } from "express";
import { calculatePTT } from "@investscape/calc-engine";
import { pttInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/ptt", (req, res) => {
  const parseResult = pttInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculatePTT(parseResult.data);
  res.json(result);
});

export default router;
