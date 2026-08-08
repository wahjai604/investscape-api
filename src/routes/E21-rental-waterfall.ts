import { Router } from "express";
import { calculateRentalWaterfall } from "@investscape/calc-engine";
import { rentalWaterfallInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/rental-waterfall", (req, res) => {
  const parseResult = rentalWaterfallInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateRentalWaterfall(parseResult.data);
  res.json(result);
});

export default router;
