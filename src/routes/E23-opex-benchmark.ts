import { Router } from "express";
import { calculateOpExBenchmark } from "@investscape/calc-engine";
import { opexBenchmarkInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/opex-benchmark", (req, res) => {
  const parseResult = opexBenchmarkInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = calculateOpExBenchmark(parseResult.data);
  res.json(result);
});

export default router;
