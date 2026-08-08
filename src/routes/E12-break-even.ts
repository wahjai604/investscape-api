import { Router } from "express";
import { calculateBreakEven } from "@investscape/calc-engine";
import { breakEvenInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/break-even", (req, res) => {
  const parseResult = breakEvenInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { mode, ...input } = parseResult.data;

  const result = calculateBreakEven(input, mode);
  res.json(result);
});

export default router;
