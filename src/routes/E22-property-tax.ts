import { Router } from "express";
import { calculatePropertyTax } from "@investscape/calc-engine";
import { propertyTaxInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/property-tax", (req, res) => {
  const parseResult = propertyTaxInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculatePropertyTax(parseResult.data);
  res.json(result);
});

export default router;
