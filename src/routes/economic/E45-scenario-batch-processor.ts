import { Router } from "express";
import { scenarioBatchProcessor } from "@investscape/economic-engine";
import { scenarioBatchInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/scenario-batch", (req, res) => {
  const parseResult = scenarioBatchInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = scenarioBatchProcessor(parseResult.data);
  res.json(result);
});

export default router;
