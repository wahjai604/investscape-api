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
import helmet from "helmet";
import dotenv from "dotenv";
import router from "./routes/index.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createLighthouseSubsystem } from "./lighthouse/bootstrap.js";

dotenv.config();

function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") {
    return 3001;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    console.error(`Invalid PORT value: "${raw}". Must be an integer between 1 and 65535.`);
    process.exit(1);
  }
  return parsed;
}

const app = express();
const PORT = resolvePort();

app.use(helmet());
app.use(cors());
// Raw-body retention for HMAC verification.
//
// Inbound service-to-service requests are signed over sha256(rawBody), so the
// verifier needs the EXACT bytes received — re-serialising the parsed object
// would produce a different hash for semantically identical JSON (key order,
// whitespace, unicode escaping) and every signature would fail.
//
// Scoped to Lighthouse paths deliberately: retaining a buffer for all ~76
// calculation routes would add memory cost per request for no benefit, since
// none of them are service-authenticated. Bounded by the 100kb limit below.
app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      if (req.url?.startsWith("/v1/lighthouse/")) {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      }
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/v1", router);

// ---------------------------------------------------------------------------
// Lighthouse cross-product integration (Relationship OS <-> InvestScape)
// ---------------------------------------------------------------------------
// Mounted, but NOT enabled. Every route inside answers 503 while
// LIGHTHOUSE_FF_STAGE1_LAUNCH_RECEIVER is false, which is its default.
//
// Mounting it rather than leaving it unregistered is deliberate: an
// unregistered route 404s, which is indistinguishable from a typo. A mounted,
// flag-disabled route 503s — an honest "this exists and is switched off".
//
// If the subsystem cannot start (no DATABASE_URL, for instance) it degrades to
// a 503-only router. The calculation engines above are unaffected.
const lighthouse = createLighthouseSubsystem();
app.use("/v1/lighthouse", lighthouse.router);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`investscape-api listening on port ${PORT}`);
  console.log("✅ 28 financial engines loaded (E1–E28)");
  console.log("✅ 16 economic engines loaded (E29–E35, E37–E45; E36 excluded pending legal review)");
  console.log("✅ 8 tax engines loaded (E46–E53)");
  console.log("✅ 52 routes registered");
  // Startup summary. Prints configuration STATE, never key material.
  const s = lighthouse.status;
  console.log(
    `🔒 lighthouse: ${s.available ? "mounted" : "unavailable"} · ` +
      `persistence=${s.persistence} · sessions=${s.sessionVerifier} · ` +
      `enabled flags=${s.enabledFlags.length === 0 ? "none" : s.enabledFlags.join(",")}` +
      (s.reason ? ` · ${s.reason}` : ""),
  );
});

function shutdown(signal: string): void {
  console.log(`${signal} received: shutting down gracefully`);
  server.close(async (err) => {
    if (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
    // Drain the Postgres pool so in-flight queries finish and the process can
    // exit without the connection keeping the event loop alive.
    try {
      await lighthouse.shutdown();
    } catch (closeError) {
      console.error("Error closing lighthouse resources:", closeError);
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
