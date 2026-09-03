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
import { createWorkspaceDisclosureRouter } from "./stage3/workspaceDisclosureRoute.ts";
import { createShareGrantRouter } from "./stage4/shareGrantRoute.ts";
import { createProjectionRouter, type ConnectionProjectionSource } from "./stage5/projectionRoute.ts";
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

/**
 * Stage 5's projection needs live workspace-availability and shared-result
 * counts. Neither has a real backing store yet — workspace availability has
 * no source of truth anywhere in this codebase, and the Stage 4 share-grant
 * store (owned by a concurrently-developed change) is not wired here. Rather
 * than block Stage 5's HTTP surface on either, this returns the conservative,
 * non-leaking defaults: unavailable and zero. Both are safe under the Stage 3
 * privacy rule (availability is only ever surfaced when consent is present,
 * and this source is not consulted at all without it) and match the "reveal
 * nothing you cannot back up" posture used throughout this file. Replace with
 * real queries once those stores exist.
 */
function defaultProjectionSource(): ConnectionProjectionSource {
  return {
    async isWorkspaceAvailable(): Promise<boolean> {
      return false;
    },
    async countActiveSharedResults(): Promise<number> {
      return 0;
    },
  };
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
  router.post(
    "/workspace-disclosure",
    createRateLimiter({ scope: "workspace_disclosure_write", rule: LIGHTHOUSE_RATE_LIMITS.read }),
  );
  router.get(
    "/workspace-disclosure/:relationshipRef",
    createRateLimiter({ scope: "workspace_disclosure_read", rule: LIGHTHOUSE_RATE_LIMITS.read }),
  );
  router.post(
    "/connection-projection",
    createRateLimiter({ scope: "connection_projection", rule: LIGHTHOUSE_RATE_LIMITS.serviceCallback }),
  );
  router.post(
    // Writes a consent-bearing record and does real work per call; tighter
    // than a plain read, but this is client-initiated (no outbound HMAC call
    // to burn), so it does not need launchRedeem's tighter guessing-loop bound.
    "/shares",
    createRateLimiter({ scope: "share_grant_create", rule: LIGHTHOUSE_RATE_LIMITS.read }),
  );
  router.get(
    "/shares",
    createRateLimiter({ scope: "share_grant_list", rule: LIGHTHOUSE_RATE_LIMITS.read }),
  );
  router.post(
    "/shares/:shareGrantId/revoke",
    createRateLimiter({ scope: "share_grant_revoke", rule: LIGHTHOUSE_RATE_LIMITS.read }),
  );

  // Authentication for every session-authenticated route family, mounted here
  // rather than inside each router — same reasoning the Stage 2 comment below
  // already documented, now actually wired. Service-authenticated routes
  // (`/link/invitations`, `/connection-projection`) are deliberately excluded:
  // they verify an inbound HMAC signature instead and must tolerate an absent
  // session by design.
  //
  // BUG FIXED 2026-09-02: `requireSession` was imported and referenced in
  // comments throughout this file but never actually invoked. Every
  // session-authenticated route therefore always saw `req.lighthouseSession`
  // as undefined and always fell into its own `deny(res, 401)` branch — a
  // fail-closed outcome (nothing was bypassed, no unauthenticated request was
  // ever accepted), but genuine users could never have authenticated either.
  // Caught during Stage 4 review, before any flag was enabled.
  //
  // `featureGate` runs AHEAD of `requireSession` on every path below, so a
  // disabled feature still answers a flat 503 for an unauthenticated caller
  // instead of leaking "authentication required" — preserving the "flag
  // checked before any other check" rule these routes' own handlers already
  // follow internally. Duplicating the 503 shape here, rather than trusting
  // each handler's own internal check to run first, is what makes that rule
  // hold even though Express evaluates this middleware before the handler.
  function featureGate(flag: string) {
    return (req: Parameters<ReturnType<typeof requireSession>>[0], res: Parameters<ReturnType<typeof requireSession>>[1], next: Parameters<ReturnType<typeof requireSession>>[2]) => {
      if (!isFeatureEnabled(flag, env)) {
        res.status(503).json({ state: "unavailable" });
        return;
      }
      next();
    };
  }
  const sessionRequired = requireSession(verifier);
  router.use(
    ["/link/accept", "/link/status", "/link/:crossProductLinkId/unlink"],
    featureGate("lighthouse.cross_product_identity_linking"),
    sessionRequired,
  );
  router.use(
    ["/workspace-disclosure", "/workspace-disclosure/:relationshipRef"],
    featureGate("lighthouse.client_workspace_disclosure"),
    sessionRequired,
  );
  router.use(
    ["/shares", "/shares/:shareGrantId/revoke"],
    featureGate("lighthouse.selected_analysis_sharing"),
    sessionRequired,
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

  // Stage 3. Session-authenticated, same reasoning as Stage 2's status/unlink
  // routes: a client managing their own disclosure consent.
  router.use(
    createWorkspaceDisclosureRouter({
      links: repositories.links,
      disclosures: repositories.workspaceDisclosure,
      auditSink: repositories.audit,
      now: () => new Date(),
      env,
    }),
  );

  // Stage 4. Session-authenticated only — unlike Stage 2/5 there is no
  // service-authenticated leg: sharing is entirely client-initiated from
  // their own independent session. `isLinkActive` queries the SAME link
  // store Stage 2 owns rather than trusting anything the request claims.
  router.use(
    createShareGrantRouter({
      grants: repositories.grants,
      auditSink: repositories.audit,
      isLinkActive: async (crossProductLinkId, clientUserRef) => {
        const link = await repositories.links.findLinkById(crossProductLinkId);
        return (
          link !== null &&
          link.investscapeUserRef === clientUserRef &&
          link.lifecycle.state === "active"
        );
      },
      now: () => new Date(),
      newShareGrantId: () => randomUUID(),
      env,
    }),
  );

  // Stage 5. Service-authenticated, same reasoning as Stage 2's invitation
  // creation route: Relationship OS asks on behalf of an already-authenticated
  // professional, and InvestScape verifies the SERVICE call rather than a
  // professional-held InvestScape session.
  router.use(
    createProjectionRouter({
      links: repositories.links,
      disclosures: repositories.workspaceDisclosure,
      source: defaultProjectionSource(),
      auditSink: repositories.audit,
      nonces: repositories.nonces,
      inboundSecrets: inboundServiceSecrets(env),
      now: () => new Date(),
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
