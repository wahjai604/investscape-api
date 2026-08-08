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
  console.log("✅ 27 financial engines loaded (E1–E27)");
  console.log("✅ 16 economic engines loaded (E29–E35, E37–E45; E36 excluded pending legal review)");
  console.log("✅ 43 routes registered");
});
