import { Router } from "express";
import { calculateCMHCPremium } from "@investscape/calc-engine";
import { cmhcInputSchema } from "../validation/schemas.js";

const router = Router();

router.post("/calculate/cmhc", (req, res) => {
  const parseResult = cmhcInputSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  try {
    const cmhcPremium = calculateCMHCPremium(parseResult.data);
    res.json({ cmhcPremium });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
