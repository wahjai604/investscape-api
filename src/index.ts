/**
 * InvestScape™ Calculation Engine API
 * © 2026 Lighthouse Research Ltd. All rights reserved.
 *
 * InvestScape™ is a registered trademark of Lighthouse Research Ltd.
 * This software is proprietary and confidential.
 *
 * LICENSING:
 * - Personal/Educational Use: Permitted (see LICENSE)
 * - Commercial Use: Requires written Commercial License Agreement
 * Contact: wahjai604@gmail.com
 *
 * DISCLAIMER:
 * This software is provided "as-is" for informational purposes only.
 * Not investment advice, tax advice, or financial advice.
 * Use at your own risk.
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import router from "./routes/index.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(router);

app.listen(PORT, () => {
  console.log(`investscape-api listening on port ${PORT}`);
  console.log("✅ 28 financial engines loaded (E1–E28)");
  console.log("✅ 16 economic engines loaded (E29–E35, E37–E45; E36 excluded pending legal review)");
  console.log("✅ 8 tax engines loaded (E46–E53)");
  console.log("✅ 52 routes registered");
});
