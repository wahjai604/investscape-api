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

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import dotenv from "dotenv";
import router from "./routes/index.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createLighthouseSubsystem } from "./lighthouse/bootstrap.js";
import {
  createCorsMiddleware,
  describeCorsPosture,
  logCorsConfiguration,
  resolveCorsConfiguration,
} from "./http/cors.ts";
import {
  createEngineAuthGuard,
  createEngineRateLimiter,
  describeEngineAuth,
  describeEngineRateLimit,
  exceptLighthouse,
  resolveEngineRateLimitConfig,
} from "./http/engineGuards.ts";

dotenv.config();

// dist/index.js -> ../public. rootDir is src/, outDir is dist/, and public/
// sits alongside both at the project root — not inside either.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

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

// Configuration is resolved BEFORE anything is mounted, so the boot log can
// state the posture of the whole surface in one place and a misconfiguration
// is visible at startup rather than at the first request that trips it.
const corsConfig = resolveCorsConfiguration(process.env);
const engineRateLimitConfig = resolveEngineRateLimitConfig(process.env);
const engineAuth = createEngineAuthGuard(process.env);

app.use(helmet());

// CORS is now allow-list driven. With CORS_ALLOWED_ORIGINS unset this behaves
// exactly as the previous bare `cors()` did — every origin allowed — and warns
// loudly at startup. See http/cors.ts for why permissive-on-unset is the right
// default HERE specifically, and for why `credentials: true` is not enabled.
app.use(createCorsMiddleware(corsConfig));

// Rate limit for the stateless calculation routes — 61 reachable endpoints
// across the 52 routers `routes/index.ts` mounts, measured by probing them all,
// not the "~76" this file's older comments estimate. Mounted BEFORE
// `express.json()` on purpose: `lighthouse/http/rateLimit.ts` asks to be
// mounted "as early as possible ... ahead of body parsing", so a flood is
// refused before this process allocates and parses a body for it.
//
// Scoped to /v1 and skipped for /v1/lighthouse, which carries its own tighter
// per-route budgets — see `exceptLighthouse` for why stacking a second counter
// on those would be wrong. CORS runs first so a browser preflight is answered
// from the cheap path and is never charged against the budget.
app.use("/v1", exceptLighthouse(createEngineRateLimiter(engineRateLimitConfig)));

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

// The calculation engines.
//
// `engineAuth.middleware` is a NO-OP unless INVESTSCAPE_FF_REQUIRE_ENGINE_AUTH
// is exactly "true", which it is not by default — so out of the box this line
// behaves identically to the `app.use("/v1", router)` it replaces. When the
// flag is armed, /v1 requires the same verified session the Lighthouse routes
// require, and refuses everything if no verifier is configured. The flag is
// read BEFORE any authentication work happens; see http/engineGuards.ts.
//
// The guard and the router are mounted in ONE `use` call deliberately: they are
// a single unit, and nothing may be inserted between the check and the thing it
// protects.
app.use("/v1", exceptLighthouse(engineAuth.middleware), router);

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

// Browser-facing landing route for the Relationship OS launch flow. This is
// the page a Relationship OS "Open in InvestScape" link actually points at
// (its path, `/relationship-os/launch`, is what `INVESTSCAPE_LAUNCH_BASE_URL`
// should resolve to once this is deployed). It POSTs to
// `/v1/lighthouse/launch/redeem` above at the same origin — see
// public/relationship-os-launch.html and its companion .js for the
// client-side flow and its security invariants (one-time code scrubbed from
// the URL before any async work, never persisted client-side).
//
// The JS is a separate same-origin file, not inlined, because helmet's
// default CSP is `script-src 'self'` with no `unsafe-inline` — an inline
// <script> block would be silently blocked by the browser rather than
// weakening the policy to allow it.
//
// Static and stateless: same fail-closed behavior as the API route it calls
// (renders 'unavailable' if Stage 1 isn't enabled server-side), so serving it
// unconditionally here is safe even before Stage 1 is turned on.
app.use(express.static(PUBLIC_DIR));
app.get("/relationship-os/launch", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "relationship-os-launch.html"));
});

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`investscape-api listening on port ${PORT}`);
  console.log("✅ 28 financial engines loaded (E1–E28)");
  console.log("✅ 16 economic engines loaded (E29–E35, E37–E45; E36 excluded pending legal review)");
  console.log("✅ 8 tax engines loaded (E46–E53)");
  console.log("✅ 52 routes registered");
  console.log("✅ Market Intelligence (E60–E66, @investscape/market-intelligence-engine) mounted — 18 routes registered");
  // Startup summary. Prints configuration STATE, never key material.
  const s = lighthouse.status;
  console.log(
    `🔒 lighthouse: ${s.available ? "mounted" : "unavailable"} · ` +
      `persistence=${s.persistence} · sessions=${s.sessionVerifier} · ` +
      `enabled flags=${s.enabledFlags.length === 0 ? "none" : s.enabledFlags.join(",")}` +
      (s.reason ? ` · ${s.reason}` : ""),
  );
  // Posture of the public calculation surface. Same rule as the line above:
  // prints configuration STATE, never key material.
  console.log(
    `🛡️  /v1 engines: cors=${describeCorsPosture(corsConfig)} · ` +
      `rate=${describeEngineRateLimit(engineRateLimitConfig)} · ` +
      `auth=${describeEngineAuth(engineAuth.mode)}`,
  );
  // Warnings last, so they are the final thing on the screen after a boot.
  for (const problem of engineRateLimitConfig.problems) {
    console.error(`[engine] ${problem}`);
  }
  logCorsConfiguration(corsConfig);
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
