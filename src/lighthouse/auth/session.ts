/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Session authentication for investscape-api.
 *
 * This service previously had NO authentication of any kind — it was a pure
 * stateless calculator, and `.env.example` said "no secrets are required by
 * this API today". Stage 1 changes that: a launch redemption binds a
 * Relationship OS session to an InvestScape analysis, and "which InvestScape
 * user" has to be a fact the server established, not a value the browser sent.
 *
 * Invariant 1: the browser NEVER establishes identity. It presents a bearer
 * token; the server verifies a signature and derives an actor reference from
 * the verified claims. A user id in a request body or header is ignored.
 *
 * WHY `jose` RATHER THAN HAND-ROLLED VERIFICATION: JWT verification has a
 * well-known family of implementation bugs — algorithm confusion ("alg":"none",
 * or an RS256 public key accepted as an HS256 shared secret), unverified
 * `kid` lookups, and non-constant-time comparisons. `jose` is audited and
 * handles those. We additionally PIN the accepted algorithms rather than
 * trusting the token header.
 *
 * SUPABASE: `sub` is the user's `auth.uid()`, which is exactly the opaque
 * `actor_ref` that `lighthouse.context_authorities` keys on. There is no
 * separate InvestScape user table and no parallel identity system.
 */

import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/** A session the SERVER has verified. There is no constructor from raw input. */
export interface AuthenticatedSession {
  /** Opaque product-local actor reference. Supabase `auth.uid()`. */
  readonly actorRef: string;
  /** Verified issuer. */
  readonly issuer: string;
  /** Seconds since epoch. */
  readonly expiresAt: number;
  /** Supabase `role` claim (e.g. "authenticated"). Never an authorization decision by itself. */
  readonly role?: string;
  /**
   * Whether the session was established with more than one factor, if the
   * issuer says so. Recorded for audit; not yet used as a gate.
   */
  readonly assuranceLevel?: string;
}

export type SessionFailure =
  | "MISSING_TOKEN"
  | "MALFORMED_AUTHORIZATION_HEADER"
  | "INVALID_TOKEN"
  | "EXPIRED_TOKEN"
  | "UNTRUSTED_ISSUER"
  | "MISSING_SUBJECT"
  | "VERIFIER_NOT_CONFIGURED";

export type SessionResult =
  | { readonly ok: true; readonly session: AuthenticatedSession }
  | { readonly ok: false; readonly reason: SessionFailure };

export interface SessionVerifier {
  verify(token: string): Promise<SessionResult>;
}

/** Algorithms we accept. Pinned — the token header never chooses. */
export const PERMITTED_JWT_ALGORITHMS = ["HS256", "RS256", "ES256"] as const;

export interface SupabaseVerifierConfig {
  /** Expected `iss`, e.g. https://<ref>.supabase.co/auth/v1 */
  readonly issuer: string;
  /** Expected `aud`. Supabase uses "authenticated". */
  readonly audience?: string;
  /** Legacy symmetric secret (HS256). Mutually exclusive with jwksUrl. */
  readonly jwtSecret?: string;
  /** Asymmetric verification endpoint (RS256/ES256), preferred. */
  readonly jwksUrl?: string;
  /** Clock skew tolerance in seconds. */
  readonly clockToleranceSeconds?: number;
}

/**
 * Verifies Supabase-issued JWTs.
 *
 * Supports both the legacy shared-secret (HS256) mode and the newer asymmetric
 * JWKS mode. Asymmetric is strongly preferred: a leaked HS256 secret lets an
 * attacker MINT sessions, whereas a leaked public key lets them do nothing.
 */
export class SupabaseSessionVerifier implements SessionVerifier {
  readonly #config: SupabaseVerifierConfig;
  readonly #getKey: JWTVerifyGetKey | Uint8Array;
  readonly #algorithms: readonly string[];

  constructor(config: SupabaseVerifierConfig) {
    this.#config = config;

    if (config.jwksUrl) {
      this.#getKey = createRemoteJWKSet(new URL(config.jwksUrl));
      // With JWKS we must NOT also accept HS256, or an attacker could sign a
      // token using the public key material as an HMAC secret.
      this.#algorithms = ["RS256", "ES256"];
    } else if (config.jwtSecret) {
      this.#getKey = new TextEncoder().encode(config.jwtSecret);
      this.#algorithms = ["HS256"];
    } else {
      throw new Error("SupabaseSessionVerifier requires either jwksUrl or jwtSecret");
    }
  }

  async verify(token: string): Promise<SessionResult> {
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(
        token,
        this.#getKey as JWTVerifyGetKey,
        {
          issuer: this.#config.issuer,
          ...(this.#config.audience ? { audience: this.#config.audience } : {}),
          // Pinned. Never read from the token header.
          algorithms: [...this.#algorithms],
          clockTolerance: this.#config.clockToleranceSeconds ?? 5,
        },
      );
      payload = result.payload;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === "ERR_JWT_EXPIRED") return { ok: false, reason: "EXPIRED_TOKEN" };
      if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
        return { ok: false, reason: "UNTRUSTED_ISSUER" };
      }
      // Everything else — bad signature, wrong algorithm, malformed — is
      // deliberately collapsed into one opaque failure. Distinguishing them
      // for the caller would be an oracle.
      return { ok: false, reason: "INVALID_TOKEN" };
    }

    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) {
      return { ok: false, reason: "MISSING_SUBJECT" };
    }

    return {
      ok: true,
      session: {
        actorRef: sub,
        issuer: String(payload.iss ?? this.#config.issuer),
        expiresAt: typeof payload.exp === "number" ? payload.exp : 0,
        ...(typeof payload.role === "string" ? { role: payload.role } : {}),
        ...(typeof payload.aal === "string" ? { assuranceLevel: payload.aal } : {}),
      },
    };
  }
}

/**
 * Local-development verifier. Accepts tokens of the form `dev:<actorRef>`.
 *
 * Gated behind an explicit constructor flag AND refused in production by
 * `createSessionVerifierFromEnv`. It exists so the Stage 1 flow can be
 * exercised end-to-end locally without standing up Supabase Auth — not as a
 * fallback that could ever be reached by accident.
 */
export class DevSessionVerifier implements SessionVerifier {
  async verify(token: string): Promise<SessionResult> {
    if (!token.startsWith("dev:")) return { ok: false, reason: "INVALID_TOKEN" };
    const actorRef = token.slice(4).trim();
    if (actorRef.length === 0) return { ok: false, reason: "MISSING_SUBJECT" };
    return {
      ok: true,
      session: {
        actorRef,
        issuer: "dev",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        role: "authenticated",
      },
    };
  }
}

/** Always fails. Used when nothing is configured, so absence is not permission. */
export class UnconfiguredSessionVerifier implements SessionVerifier {
  async verify(): Promise<SessionResult> {
    return { ok: false, reason: "VERIFIER_NOT_CONFIGURED" };
  }
}

/** Extracts a bearer token without leaking its value into any error. */
export function extractBearerToken(
  authorization: string | undefined,
): { readonly ok: true; readonly token: string } | { readonly ok: false; readonly reason: SessionFailure } {
  if (!authorization) return { ok: false, reason: "MISSING_TOKEN" };
  const match = /^Bearer[ ]+(.+)$/i.exec(authorization.trim());
  if (!match?.[1]) return { ok: false, reason: "MALFORMED_AUTHORIZATION_HEADER" };
  return { ok: true, token: match[1].trim() };
}

/**
 * Builds the verifier from the environment, failing closed.
 *
 * Order matters: production may only ever get a real Supabase verifier.
 */
export function createSessionVerifierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionVerifier {
  const isProduction = env.NODE_ENV === "production";
  const issuer = env.SUPABASE_JWT_ISSUER;
  const jwksUrl = env.SUPABASE_JWKS_URL;
  const jwtSecret = env.SUPABASE_JWT_SECRET;

  if (issuer && (jwksUrl || jwtSecret)) {
    return new SupabaseSessionVerifier({
      issuer,
      audience: env.SUPABASE_JWT_AUDIENCE ?? "authenticated",
      ...(jwksUrl ? { jwksUrl } : { jwtSecret }),
    });
  }

  if (!isProduction && env.LIGHTHOUSE_ALLOW_DEV_SESSIONS === "true") {
    return new DevSessionVerifier();
  }

  // Nothing configured: every request is unauthenticated. Fail closed rather
  // than fall back to something permissive.
  return new UnconfiguredSessionVerifier();
}

/** Exported for tests that need a deterministic local JWKS. */
export { createLocalJWKSet };
