import { Router } from "express";
import { qualifyForMortgage } from "@investscape/calc-engine";
import { qualifyInputSchema, type QualifyOutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/qualify", (req, res) => {
  const parseResult = qualifyInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = qualifyForMortgage(parseResult.data);

  const response: QualifyOutput = result;
  res.json(response);
});

export default router;
