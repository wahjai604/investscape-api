import { Router } from "express";
import mortgageRouter from "./mortgage.js";
import exitRouter from "./exit.js";

const router = Router();

router.use(mortgageRouter);
router.use(exitRouter);

export default router;
