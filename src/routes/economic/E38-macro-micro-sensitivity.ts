import { Router } from "express";
import { macroMicroSensitivity } from "@investscape/economic-engine";
import { macroMicroSensitivityInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/macro-micro-sensitivity", (req, res) => {
  const parseResult = macroMicroSensitivityInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const result = macroMicroSensitivity(parseResult.data);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
