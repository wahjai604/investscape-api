import { Router } from "express";
import { calculateFXConversion } from "@investscape/calc-engine";
import { fxConversionInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/fx-conversion", (req, res) => {
  const parseResult = fxConversionInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateFXConversion(parseResult.data);
  res.json(result);
});

export default router;
