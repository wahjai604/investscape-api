import { Router } from "express";
import { calculateDataProvenance } from "@investscape/calc-engine";
import { dataProvenanceInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/data-provenance", (req, res) => {
  const parseResult = dataProvenanceInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateDataProvenance(parseResult.data);
  res.json(result);
});

export default router;
