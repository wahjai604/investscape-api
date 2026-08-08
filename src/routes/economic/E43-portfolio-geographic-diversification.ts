import { Router } from "express";
import { portfolioGeographicDiversification } from "@investscape/economic-engine";
import { portfolioDiversificationInputSchema } from "../../validation/economic-schemas.js";

const router = Router();

router.post("/calculate/portfolio-geo-diversification", (req, res) => {
  const parseResult = portfolioDiversificationInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const result = portfolioGeographicDiversification(parseResult.data);
  res.json(result);
});

export default router;
