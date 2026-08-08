import { Router } from "express";
import { calculateCapitalStack } from "@investscape/calc-engine";
import { capitalStackInputSchema, type CapitalStackOutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/capitalstack", (req, res) => {
  const parseResult = capitalStackInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateCapitalStack(parseResult.data.tranches);

  const response: CapitalStackOutput = result;
  res.json(response);
});

export default router;
