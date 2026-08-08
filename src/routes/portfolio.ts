import { Router } from "express";
import { rollupPortfolio } from "@investscape/calc-engine";
import { portfolioInputSchema, type PortfolioOutput } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/portfolio", (req, res) => {
  const parseResult = portfolioInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { properties, irrGuess } = parseResult.data;

  const result = irrGuess === undefined ? rollupPortfolio(properties) : rollupPortfolio(properties, irrGuess);

  const response: PortfolioOutput = result;
  res.json(response);
});

export default router;
