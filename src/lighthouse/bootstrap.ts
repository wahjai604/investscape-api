/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Lighthouse composition root.
 *
 * Builds the integration subsystem from the environment and hands back a
 * router. Called once at startup from src/index.ts.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 * 1. It never takes the calculation API down with it. investscape-api's ~76
 *    engine routes are stateless and have no business failing because a
 *    cross-product integration is misconfigured. If Lighthouse cannot start,
 *    it mounts a router that answers 503 and logs why — the engines keep
 *    serving.
 *
 * 2. It never "helpfully" enables anything. A missing database, a missing
 *    verifier, or a disabled flag all produce the same outcome: the integration
 *    is unavailable. Absence of configuration is never treated as permission.
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { createPgClientFromEnv, type PgTransactionalClient } from "./persistence/pgClient.ts";
import { buildRepositoriesFromEnv, type LighthouseRepositories } from "./persistence/repositories.ts";
import { createSessionVerifierFromEnv, type SessionVerifier } from "./auth/session.ts";
import { createLaunchRouter } from "./stage1/launchRoute.ts";
import { createLinkRouter } from "./stage2/linkRoute.ts";
import { requireSession } from "./auth/middleware.ts";
import { createRateLimiter, LIGHTHOUSE_RATE_LIMITS } from "./http/rateLimit.ts";
import { generateNonce } from "./service-auth/hmac.ts";
import { LIGHTHOUSE_FEATURE_FLAGS, isFeatureEnabled } from "./config/featureFlags.ts";

export interface LighthouseSubsystem {
  readonly router: Router;
  readonly status: LighthouseStatus;
  /** Present only when Postgres is configured. */
  readonly sql: PgTransactionalClient | null;
  shutdown(): Promise<void>;
}

export interface LighthouseStatus {
  readonly available: boolean;
  readonly persistence: "postgres" | "in-memory" | "unconfigured";
  readonly sessionVerifier: "supabase" | "dev" | "unconfigured";
  readonly enabledFlags: readonly string[];
  readonly reason?: string;
}

/** A router that answers every path with an honest 503. */
function unavailableRouter(reason: string): Router {
  const router = Router();
  router.all("/*splat", (_req, res) => {
    res.status(503).json({ state: "unavailable", reason });
  });
  return router;
}

function describeVerifier(env: NodeJS.ProcessEnv, verifier: SessionVerifier): LighthouseStatus["sessionVerifier"] {
  const name = verifier.constructor.name;
  if (name === "SupabaseSessionVerifier") return "supabase";
  if (name === "DevSessionVerifier") return "dev";
  return "unconfigured";
}

/**
 * Reads the OUTBOUND service credential — the one we sign requests to
 * Relationship OS with. Returns null when unset, so the redemption client
 * reports 'unconfigured' rather than signing with an empty secret.
 */
/**
 * Reads the INBOUND service credential — the one Relationship OS signs its
 * requests to us with. Returns an empty map when unset, which makes every
 * service-authenticated route answer 503 rather than accept unauthenticated
 * calls. Absence of a key is never treated as "no verification needed".
 */
function inboundServiceSecrets(env: NodeJS.ProcessEnv): Record<string, string> {
  const keyId = env.LIGHTHOUSE_SVC_INBOUND_KEY_ID;
  const secret = env.LIGHTHOUSE_SVC_INBOUND_SECRET;
  if (!keyId || !secret) return {};
  return { [keyId]: secret };
}

function outboundServiceConfig(env: NodeJS.ProcessEnv) {
  const baseUrl = env.RELATIONSHIP_OS_BASE_URL;
  const keyId = env.LIGHTHOUSE_SVC_OUTBOUND_KEY_ID;
  const secret = env.LIGHTHOUSE_SVC_OUTBOUND_SECRET;
  if (!baseUrl || !keyId || !secret) return null;
  return { baseUrl, keyId, secret };
}

export function createLighthouseSubsystem(
  env: NodeJS.ProcessEnv = process.env,
): LighthouseSubsystem {
  const enabledFlags = LIGHTHOUSE_FEATURE_FLAGS
    .filter((flag) => isFeatureEnabled(flag, env));

  let sql: PgTransactionalClient | null = null;
  let repositories: LighthouseRepositories;

  try {
    sql = createPgClientFromEnv(env);
    repositories = buildRepositoriesFromEnv(sql, env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[lighthouse] integration unavailable: ${reason}`);
    return {
      router: unavailableRouter("persistence_not_configured"),
      status: {
        available: false,
        persistence: "unconfigured",
        sessionVerifier: "unconfigured",
        enabledFlags,
        reason,
      },
      sql: null,
      shutdown: async () => { await sql?.close(); },
    };
  }

  const verifier = createSessionVerifierFromEnv(env);

  const router = Router();

  // Rate limits are applied per route family, BEFORE the handlers.
  //
  // Ordering matters and is deliberate: the limiter runs ahead of signature
  // verification and session checks. Verifying an HMAC or fetching a JWKS is
  // real work, and an unauthenticated flood should be stopped before we spend
  // it — a limiter placed after authentication protects the database but not
  // the CPU that authentication burns.
  //
  // This is a per-process, in-memory counter. It is NOT a distributed limiter:
  // two instances behind a load balancer each get their own budget, so the
  // effective limit is N x the number below. The store sits behind an interface
  // so a shared backend can replace it without touching these call sites.
  router.post(
    "/launch/redeem",
    createRateLimiter({ scope: "launch_redeem", rule: LIGHTHOUSE_RATE_LIMITS.launchRedeem }),
  );
  router.post(
    "/link/accept",
    // Same budget as launch redemption: this is the other endpoint where a
    // caller presents a secret they either have or are guessing.
    createRateLimiter({ scope: "link_accept", rule: LIGHTHOUSE_RATE_LIMITS.launchRedeem }),
  );
  router.post(
    "/link/invitations",
    createRateLimiter({ scope: "link_invitations", rule: LIGHTHOUSE_RATE_LIMITS.serviceCallback }),
  );
  router.get(
    "/link/status",
    createRateLimiter({ scope: "link_status", rule: LIGHTHOUSE_RATE_LIMITS.read }),
  );

  router.use(
    createLaunchRouter({
      config: outboundServiceConfig(env),
      redemption: {
        fetch: globalThis.fetch,
        newOperationId: () => randomUUID(),
      },
      bindings: repositories.bindings,
      auditSink: repositories.audit,
      newAnalysisId: () => randomUUID(),
      now: () => new Date(),
      env,
    }),
  );

  // Stage 2. `requireSession` is applied HERE rather than inside the router, so
  // authentication cannot be bypassed by a future route being added to that
  // file without remembering to guard it. The invitation-creation route is
  // service-authenticated instead and tolerates an absent session by design —
  // it verifies an HMAC signature over the raw body.
  router.use(
    createLinkRouter({
      links: repositories.links,
      auditSink: repositories.audit,
      nonces: repositories.nonces,
      inboundSecrets: inboundServiceSecrets(env),
      now: () => new Date(),
      newInvitationId: () => randomUUID(),
      env,
    }),
  );

  return {
    router,
    status: {
      available: true,
      persistence: repositories.mode,
      sessionVerifier: describeVerifier(env, verifier),
      enabledFlags,
    },
    sql,
    shutdown: async () => { await sql?.close(); },
  };
}

/** Re-exported so the entry point can log a startup summary. */
export { generateNonce };
