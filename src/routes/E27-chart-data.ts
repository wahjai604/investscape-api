import { Router } from "express";
import { generateChartData } from "@investscape/calc-engine";
import { chartDataInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/chart-data", (req, res) => {
  const parseResult = chartDataInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = generateChartData(parseResult.data);
  res.json(result);
});

export default router;
