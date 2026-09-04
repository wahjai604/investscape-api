/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Guards for the /v1 calculation-engine surface.
 *
 * SIZE OF THAT SURFACE, MEASURED RATHER THAN ESTIMATED: `routes/index.ts`
 * mounts 52 routers exposing 61 reachable endpoints. Other comments in this
 * codebase say "~76"; that number counts 70 route declarations across
 * `src/routes/**`, 9 of which live in `us-qualifier/`, `us-tax-strategies/` and
 * `syndication-waterfall/` and are never imported by `routes/index.ts`, so they
 * are dead files rather than live routes. Every one of the 61 was probed and
 * answered from its own handler with these guards installed at their defaults.
 *
 * Before this file existed, that surface had NO rate limit and NO
 * authentication of any kind: `app.use("/v1", router)` and nothing else. The
 * Lighthouse subsystem next door has had both since Stage 1. This closes the
 * gap using the SAME two modules Lighthouse uses — `http/rateLimit.ts` and
 * `auth/middleware.ts` — rather than a second, subtly different mechanism.
 *
 * ============================================================================
 * WHY REUSING `lighthouse/http/rateLimit.ts` IS CORRECT AND NOT A LAYER BREACH
 * ============================================================================
 * That module lives under `lighthouse/` and its header names the
 * `/v1/lighthouse/*` family, so reusing it from the core API deserves a
 * justification rather than an import.
 *
 * It is reusable because nothing in it is Lighthouse-specific. `createRateLimiter`
 * takes a scope, a rule, an optional store and an optional trusted-hop count; it
 * reads only `req.ip`, `req.method`, `req.path` and an already-verified session
 * (structurally, without importing the auth module). The ONE Lighthouse-coupled
 * export is the `LIGHTHOUSE_RATE_LIMITS` preset table, and this file does not use
 * it — the engine rule is derived from the environment below.
 *
 * The alternative — adding `express-rate-limit`, or hand-rolling a second
 * limiter — was rejected on the merits, not on effort:
 *
 *   - Two limiters means two failure policies. This one FAILS CLOSED on
 *     limiter error and hashes caller identity out of the store. A second
 *     implementation would have to re-derive both decisions correctly, and the
 *     usual default in off-the-shelf middleware is to fail OPEN.
 *   - `X-Forwarded-For` handling is the part everyone gets wrong. This module
 *     ignores the header entirely unless an operator states how many proxy hops
 *     they actually control. That property is worth more than any feature a
 *     dependency would add, and it is exactly the property a second mechanism
 *     would silently lack.
 *   - One shared store means one memory bound for the whole process, instead of
 *     two independently unbounded maps.
 *
 * The file's own guidance is followed rather than reinterpreted: it says mount
 * as early as possible, ahead of body parsing — so the engine limiter is
 * mounted before `express.json()` in `index.ts`, which means a flood is refused
 * before this process allocates or parses a 100kb body for it.
 *
 * ---------------------------------------------------------------------------
 * KNOWN LIMITS, RESTATED SO THEY ARE NOT REDISCOVERED IN AN INCIDENT
 * ---------------------------------------------------------------------------
 *   - Per-PROCESS, in-memory. N instances behind a load balancer means N times
 *     the configured budget, and every deploy resets every counter.
 *   - Fixed window, so a caller can burst up to `2 * limit - 1` across a window
 *     boundary. Known and accepted; see `rateLimit.ts`.
 *   - Useless against a distributed source. This is an edge/WAF job.
 *   - With `trustedProxyHops = 0` (the default) behind a reverse proxy, EVERY
 *     request keys to the proxy's address and the whole world shares one
 *     budget. That is the single most likely way this configuration hurts real
 *     users, which is why the env var exists and is documented in
 *     `.env.example`. The default is still 0, because guessing a hop count
 *     wrong in the other direction lets any client forge its own identity via a
 *     header and deletes the limiter outright.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  createRateLimiter,
  InMemoryRateLimitStore,
  type RateLimitRule,
  type RateLimitStore,
} from "../lighthouse/http/rateLimit.ts";
import { requireSession } from "../lighthouse/auth/middleware.ts";
import {
  createSessionVerifierFromEnv,
  UnconfiguredSessionVerifier,
  type SessionVerifier,
} from "../lighthouse/auth/session.ts";
import { isCoreFeatureEnabled } from "./featureFlags.ts";

// ---------------------------------------------------------------------------
// Path scoping
// ---------------------------------------------------------------------------

/**
 * The Lighthouse mount, which these guards deliberately skip.
 *
 * Both guards are installed on the `/v1` prefix, and `/v1/lighthouse` sits
 * underneath it, so without this they would also apply there. They must not:
 *
 *   - Every Lighthouse route already carries its OWN per-route limiter with a
 *     budget chosen for that route (5/min on `/launch/redeem`, 300/min on the
 *     service callbacks). Adding a second, coarser counter on top would make
 *     the effective limit the minimum of two numbers, which is unbudgeted,
 *     invisible in review, and would silently tighten a limit somebody reasoned
 *     about carefully.
 *   - Lighthouse authenticates per route family with its own feature gates. A
 *     core-API session requirement layered above would change 503-when-disabled
 *     into 401, breaking the "flag before auth" ordering those routes rely on.
 *
 * The predicate reads `originalUrl` rather than `req.path` so it gives the same
 * answer wherever it is mounted — the two guards attach at different points in
 * the chain. If a request's encoding ever makes this disagree with Express's
 * own mount matching, it disagrees toward APPLYING the guard, never toward
 * skipping it.
 */
const LIGHTHOUSE_MOUNT = "/v1/lighthouse";

function isLighthouseRequest(req: Request): boolean {
  const raw = req.originalUrl || req.url || "";
  const end = Math.min(
    raw.indexOf("?") === -1 ? raw.length : raw.indexOf("?"),
    raw.indexOf("#") === -1 ? raw.length : raw.indexOf("#"),
  );
  // Lowercased because Express route matching is case-insensitive by default,
  // so `/V1/Lighthouse/...` reaches the Lighthouse router too.
  const pathname = raw.slice(0, end).toLowerCase();
  return pathname === LIGHTHOUSE_MOUNT || pathname.startsWith(`${LIGHTHOUSE_MOUNT}/`);
}

/** Wraps a handler so it runs for the calculation engines but not for Lighthouse. */
export function exceptLighthouse(handler: RequestHandler): RequestHandler {
  return function exceptLighthouseMiddleware(req: Request, res: Response, next: NextFunction) {
    if (isLighthouseRequest(req)) {
      next();
      return;
    }
    return handler(req, res, next);
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export const ENGINE_RATE_LIMIT_VARS = {
  limit: "ENGINE_RATE_LIMIT_MAX",
  windowMs: "ENGINE_RATE_LIMIT_WINDOW_MS",
  trustedProxyHops: "ENGINE_RATE_LIMIT_TRUSTED_PROXY_HOPS",
} as const;

/**
 * Default budget for the engine surface: 600 requests per minute per caller.
 *
 * DERIVED, NOT GUESSED. One "analysis" in the existing client fans out across
 * many engines — there are 28 financial, 16 economic and 8 tax routes, and a
 * full recompute touches a large fraction of them in one burst. At 600/min a
 * caller can drive roughly 20 full multi-engine recomputes per minute, i.e. one
 * every three seconds, sustained, forever. No human moving a slider gets near
 * that; a scraping loop passes it in under a second.
 *
 * The bound is intentionally on the generous side of that estimate. The failure
 * modes are asymmetric: a limit set too low breaks the calculators for real
 * users and gets the whole control blamed and removed, while a limit set
 * somewhat too high still converts an unbounded flood into a bounded one. The
 * engines must never be taken down by a hardening default.
 *
 * Note the fixed-window boundary burst applies: the true worst case is
 * `2 * limit - 1` in a short span. Halve the window rather than the limit if
 * that matters.
 */
export const ENGINE_RATE_LIMIT_DEFAULTS: RateLimitRule = {
  limit: 600,
  windowMs: 60_000,
};

/** Sanity bounds. A value outside these is a typo, not an intention. */
const LIMIT_MAX = 1_000_000;
const WINDOW_MIN_MS = 1_000;
const WINDOW_MAX_MS = 3_600_000;
const HOPS_MAX = 10;

export interface EngineRateLimitConfig {
  readonly rule: RateLimitRule;
  readonly trustedProxyHops: number;
  /** Human-readable parse complaints, for the startup log. Empty when clean. */
  readonly problems: readonly string[];
}

/**
 * Parses one integer env var, falling back to the default on anything invalid.
 *
 * FALLING BACK RATHER THAN EXITING is the deliberate choice, and it differs
 * from `resolvePort`, which exits. The reasoning is `rateLimit.ts`'s own: "a
 * kill switch on a protective control is a one-variable outage waiting to
 * happen". A typo in a tuning knob should not take the calculation engines off
 * the internet. What matters is the direction of the fallback — it lands on the
 * DEFAULT, which is protective, and never on "unlimited". An invalid value can
 * therefore only ever make the limiter stricter than the operator intended,
 * never absent.
 */
function readBoundedInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    problems.push(
      `${name}="${raw}" is not an integer in [${min}, ${max}]; using the default ${fallback}`,
    );
    return fallback;
  }
  return parsed;
}

/** Reads the engine budget from the environment. Pure; does no logging. */
export function resolveEngineRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): EngineRateLimitConfig {
  const problems: string[] = [];

  // `limit: 0` is permitted and means "deny everything" — `rateLimit.ts` calls
  // that "a legitimate way to close a route", and it is the emergency brake for
  // this surface if the engines ever have to be shut off without a deploy.
  const limit = readBoundedInt(
    env,
    ENGINE_RATE_LIMIT_VARS.limit,
    ENGINE_RATE_LIMIT_DEFAULTS.limit,
    0,
    LIMIT_MAX,
    problems,
  );
  const windowMs = readBoundedInt(
    env,
    ENGINE_RATE_LIMIT_VARS.windowMs,
    ENGINE_RATE_LIMIT_DEFAULTS.windowMs,
    WINDOW_MIN_MS,
    WINDOW_MAX_MS,
    problems,
  );
  const trustedProxyHops = readBoundedInt(
    env,
    ENGINE_RATE_LIMIT_VARS.trustedProxyHops,
    0,
    0,
    HOPS_MAX,
    problems,
  );

  return { rule: { limit, windowMs }, trustedProxyHops, problems };
}

/**
 * Logs denials without becoming a log flood itself.
 *
 * An unlogged limiter is invisible: nobody can tell a 429 storm from a quiet
 * afternoon. But one line per denial hands an attacker a cheap way to fill the
 * disk, so this emits at most one line per window and reports how many it
 * swallowed. Throwing here cannot affect the verdict — `createRateLimiter`
 * swallows exceptions from this callback on purpose.
 */
function throttledDenialLogger(windowMs: number): (denial: { scope: string; reason: string }) => void {
  let suppressed = 0;
  let lastLoggedMs = 0;

  return (denial) => {
    const nowMs = Date.now();
    if (nowMs - lastLoggedMs < windowMs) {
      suppressed += 1;
      return;
    }
    const tail = suppressed > 0 ? ` (+${suppressed} similar suppressed)` : "";
    lastLoggedMs = nowMs;
    suppressed = 0;
    console.warn(`[engine] rate limit denial: scope=${denial.scope} reason=${denial.reason}${tail}`);
  };
}

/**
 * Builds the /v1 engine rate limiter.
 *
 * The store is passed in explicitly rather than left to default so a single
 * bounded map covers this surface — one memory ceiling, not one per limiter.
 */
export function createEngineRateLimiter(
  config: EngineRateLimitConfig,
  store: RateLimitStore = new InMemoryRateLimitStore(),
): RequestHandler {
  return createRateLimiter({
    // Namespaced away from every Lighthouse scope, so an engine flood can never
    // consume a Lighthouse route's budget or vice versa — the scope is hashed
    // into the counter key.
    scope: "engine_v1",
    rule: config.rule,
    store,
    trustedProxyHops: config.trustedProxyHops,
    onDenied: throttledDenialLogger(config.rule.windowMs),
  });
}

/** One-line startup summary. */
export function describeEngineRateLimit(config: EngineRateLimitConfig): string {
  const perWindow = `${config.rule.limit}/${Math.round(config.rule.windowMs / 1000)}s`;
  const hops =
    config.trustedProxyHops === 0
      ? "xff=ignored"
      : `xff=trusted(${config.trustedProxyHops} hop${config.trustedProxyHops === 1 ? "" : "s"})`;
  return `${perWindow} per caller · ${hops}`;
}

// ---------------------------------------------------------------------------
// Flag-gated session requirement
// ---------------------------------------------------------------------------

/** The flag that arms the session requirement on /v1. */
export const REQUIRE_ENGINE_AUTH_FLAG = "investscape.require_engine_auth";

export type EngineAuthMode =
  /** Flag off. Requests pass through untouched — today's behaviour. */
  | "disabled"
  /** Flag on and a real verifier is configured. Bearer token required. */
  | "required"
  /** Flag on but NO verifier is configured. Everything is refused. */
  | "required_but_unconfigured";

export interface EngineAuthGuard {
  readonly middleware: RequestHandler;
  /** Snapshot taken at startup, for the boot log only. */
  readonly mode: EngineAuthMode;
}

/**
 * Builds the flag-gated session requirement for /v1.
 *
 * ============================================================================
 * ORDERING: THE FLAG IS CHECKED BEFORE AUTHENTICATION. NOT AFTER.
 * ============================================================================
 * This repository has already been bitten by the inverse. `bootstrap.ts`
 * records the fix: `featureGate` was moved AHEAD of `requireSession` so a
 * disabled feature answers a flat 503 rather than leaking "authentication
 * required" to an unauthenticated caller — which would confirm the route
 * exists and is merely switched off. The rule established there is followed
 * here exactly: NOTHING about the caller is inspected until the flag has been
 * read.
 *
 * The COMPOSITION differs from `bootstrap.ts`, and the difference is the whole
 * point of this guard, so it is spelled out rather than left to be inferred:
 *
 *   Lighthouse:  flag OFF -> 503. The flag gates whether a feature EXISTS.
 *   Engines:     flag OFF -> next(). The flag gates whether auth is REQUIRED.
 *
 * The engines already exist and already serve every caller. This flag can only
 * ever ADD a requirement. That is why it is one middleware that decides and
 * delegates, rather than `[featureGate(flag), sessionRequired]` — in an Express
 * chain the second handler runs whenever the first calls `next()`, so a
 * pass-through gate cannot skip the handler that follows it.
 *
 * It also means this flag can never widen access. Read the branches below: the
 * flag-on path is strictly more restrictive than the flag-off path at every
 * step, and there is no value of the environment that makes an authenticated
 * check disappear. A flag never bypasses authorization.
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED WHEN THE VERIFIER IS UNCONFIGURED
 * ---------------------------------------------------------------------------
 * `createSessionVerifierFromEnv` returns `UnconfiguredSessionVerifier` when no
 * Supabase issuer is set, and that verifier already rejects every token — so
 * the flag-on path would fail closed with a 401 even without the branch below.
 * The branch is still there for two reasons. It makes the fail-closed property
 * a LOCAL, readable fact instead of one that depends on a class three files
 * away continuing to behave; and it answers 503 rather than 401, because
 * "present a token" is unactionable advice when no token could ever verify. The
 * honest answer to a caller hitting a service whose auth backend was never
 * configured is "unavailable", and it matches the shape Lighthouse already
 * returns from `unavailableRouter` and `featureGate`.
 *
 * The flag is re-read on every request rather than captured at startup, exactly
 * as `bootstrap.ts`'s `featureGate` does. The VERIFIER is built once, because
 * constructing a remote JWKS client per request would be its own denial of
 * service.
 */
export function createEngineAuthGuard(
  env: NodeJS.ProcessEnv = process.env,
  verifier: SessionVerifier = createSessionVerifierFromEnv(env),
): EngineAuthGuard {
  const verifierUnconfigured = verifier instanceof UnconfiguredSessionVerifier;
  const sessionRequired = requireSession(verifier);

  const mode: EngineAuthMode = !isCoreFeatureEnabled(REQUIRE_ENGINE_AUTH_FLAG, env)
    ? "disabled"
    : verifierUnconfigured
      ? "required_but_unconfigured"
      : "required";

  const middleware: RequestHandler = function requireEngineSessionIfEnabled(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    // 1. FLAG FIRST. No header is read, no token is parsed, no verifier is
    //    touched before this line. See the ordering note above.
    if (!isCoreFeatureEnabled(REQUIRE_ENGINE_AUTH_FLAG, env)) {
      next();
      return;
    }

    // 2. Armed but unconfigured: refuse. Never "allow everyone through".
    if (verifierUnconfigured) {
      res.status(503).json({ state: "unavailable" });
      return;
    }

    // 3. Only now, authenticate — with the SAME verifier and the SAME
    //    middleware the Lighthouse routes use, so there is one definition of
    //    "a valid session" in this service rather than two.
    return sessionRequired(req, res, next);
  };

  return { middleware, mode };
}

/** One-line startup summary. */
export function describeEngineAuth(mode: EngineAuthMode): string {
  switch (mode) {
    case "disabled":
      return "off (flag disabled — /v1 is public, as before)";
    case "required":
      return "REQUIRED (verified session)";
    case "required_but_unconfigured":
      return "REQUIRED but NO VERIFIER CONFIGURED — /v1 answers 503";
  }
}
