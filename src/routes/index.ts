import { Router } from "express";
import mortgageRouter from "./mortgage.js";
import exitRouter from "./exit.js";
import qualifyRouter from "./qualify.js";
import dscrRouter from "./dscr.js";
import cashflowRouter from "./cashflow.js";
import returnsRouter from "./returns.js";
import capitalstackRouter from "./capitalstack.js";
import portfolioRouter from "./portfolio.js";

const router = Router();

router.use(mortgageRouter);
router.use(exitRouter);
router.use(qualifyRouter);
router.use(dscrRouter);
router.use(cashflowRouter);
router.use(returnsRouter);
router.use(capitalstackRouter);
router.use(portfolioRouter);

export default router;
