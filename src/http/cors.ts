/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Cross-origin policy for the whole HTTP surface.
 *
 * REPLACES a bare `app.use(cors())`, which allowed EVERY origin globally —
 * including on /v1/lighthouse, where consent records and share grants live.
 *
 * ============================================================================
 * WHAT CORS IS, AND THEREFORE WHAT THIS CANNOT DO
 * ============================================================================
 * CORS is a policy the BROWSER enforces on behalf of the user, about whether
 * page JavaScript from origin A may READ a response from origin B. It is not an
 * access control on this server:
 *
 *   - curl, Postman, a script, or any non-browser client ignores it entirely.
 *     An allow-list here stops none of them and is not meant to.
 *   - A denied cross-origin GET still EXECUTES here. The browser withholds the
 *     response from the calling script; the work was still done.
 *
 * So this narrows the blast radius of a malicious page in a logged-in user's
 * browser. It is not, and must not be mistaken for, authentication. The control
 * that decides whether a caller may invoke the engines at all is the session
 * requirement in `engineGuards.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHY UNSET STAYS PERMISSIVE, WHICH LOOKS LIKE THE WRONG DEFAULT
 * ---------------------------------------------------------------------------
 * Everywhere else in this codebase, absence of configuration means DENY, and
 * that rule is right because those controls guard capabilities. This one is
 * different, and the difference is worth stating rather than quietly breaking
 * the rule:
 *
 *   - An empty allow-list is not "deny everything dangerous", it is "deny the
 *     existing HTML prototype and every developer's localhost", i.e. a total
 *     outage of the only consumers this API has, triggered by a variable nobody
 *     had to set before this change existed.
 *   - Failing closed here would buy no confidentiality, because today the /v1
 *     engines are unauthenticated and stateless: a browser reading them
 *     cross-origin learns arithmetic it could have computed itself. There is no
 *     ambient authority to steal, because there is no session and no cookie.
 *
 * The moment either of those stops being true — `INVESTSCAPE_FF_REQUIRE_ENGINE_AUTH`
 * on, or a cookie-based session introduced — the default should flip to deny.
 * Until then the honest posture is: preserve today's behaviour EXACTLY, and log
 * a warning loud enough that "unconfigured" cannot be mistaken for "reviewed".
 * A silent permissive default is the actual failure mode; a loud one is a
 * to-do item that announces itself on every boot.
 *
 * ---------------------------------------------------------------------------
 * WHY `credentials: true` IS NOT SET
 * ---------------------------------------------------------------------------
 * It is not needed and it is not free.
 *
 * NOT NEEDED: this service authenticates with a Bearer token in the
 * `Authorization` header (`auth/session.ts`, `extractBearerToken`). A header a
 * script sets deliberately is not a credential the browser attaches
 * automatically, so it rides on a normal, non-credentialed CORS request. There
 * is no cookie, no session cookie, and no HTTP auth anywhere in this codebase —
 * `grep` for `cookie` finds nothing that sets one.
 *
 * NOT FREE: `credentials: true` tells the browser it is safe to attach AMBIENT
 * authority (cookies, TLS client certs) to cross-origin requests and hand the
 * response back to the calling script. Combined with a reflected origin that is
 * the classic account-takeover CORS bug. Turning it on is also irreversible in
 * practice — clients start relying on it.
 *
 * If a future change introduces cookie sessions, `credentials: true` must be
 * added TOGETHER with an allow-list that is mandatory (no permissive fallback),
 * never before.
 */

import cors from "cors";
import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";

/** Env var holding a comma-separated list of exact allowed origins. */
export const CORS_ALLOWED_ORIGINS_VAR = "CORS_ALLOWED_ORIGINS";

export type CorsPosture =
  /** Var unset/empty: every origin allowed, exactly as before this change. */
  | "unrestricted"
  /** Var set: only the listed origins are allowed. */
  | "allowlist";

export interface CorsConfiguration {
  readonly posture: CorsPosture;
  /** Normalised, de-duplicated origins. Empty when posture is "unrestricted". */
  readonly allowedOrigins: readonly string[];
  /** Entries that were not usable as an origin, verbatim, for the startup log. */
  readonly rejectedEntries: readonly string[];
  /** `[original, normalised]` pairs, so a silent rewrite is still visible. */
  readonly normalisedEntries: readonly (readonly [string, string])[];
}

/**
 * Reduces a configured entry to a bare origin, or null if it is not one.
 *
 * Normalising rather than rejecting `https://app.example.com/` and
 * `https://app.example.com/index.html` is deliberate: the browser only ever
 * sends scheme://host[:port] in `Origin`, so a trailing slash in the config
 * would otherwise never match anything and would present as "the allow-list is
 * ignoring my origin" — a failure mode that costs an afternoon to diagnose.
 * The rewrite is reported at startup so it is not silent.
 *
 * A literal "*" is NOT special-cased. It is not a valid origin, so it lands
 * here as unusable and is dropped with a warning. That is on purpose: if `*`
 * meant "allow everything", then one stray entry in a list of five would
 * silently open the whole allow-list. Blanket permissiveness must be expressed
 * by leaving the variable UNSET, which is loud, rather than by a character
 * buried in a comma-separated string, which is not.
 */
function normaliseOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // http/https only. A `file:`, `data:` or custom-scheme origin is either a
  // mistake or an attempt to allow something whose origin the browser reports
  // as "null" — and "null" is an origin ANY sandboxed iframe can present, so
  // allow-listing it allows everyone.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname.length === 0) return null;

  // `URL.origin` is exactly scheme://host[:port] with the default port elided —
  // the same serialisation a browser puts in the `Origin` header.
  return url.origin;
}

/** Reads the allow-list from the environment. Pure; does no logging. */
export function resolveCorsConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): CorsConfiguration {
  const raw = env[CORS_ALLOWED_ORIGINS_VAR];

  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      posture: "unrestricted",
      allowedOrigins: [],
      rejectedEntries: [],
      normalisedEntries: [],
    };
  }

  const allowed: string[] = [];
  const rejected: string[] = [];
  const normalised: (readonly [string, string])[] = [];
  const seen = new Set<string>();

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue; // Tolerate a trailing comma.

    const origin = normaliseOrigin(trimmed);
    if (origin === null) {
      rejected.push(trimmed);
      continue;
    }
    if (origin !== trimmed) normalised.push([trimmed, origin]);
    if (seen.has(origin)) continue;
    seen.add(origin);
    allowed.push(origin);
  }

  // NOTE: a list of nothing but unusable entries stays in "allowlist" posture
  // with an empty list — i.e. it denies every cross-origin read. It does NOT
  // fall back to permissive. Someone who set the variable expressed an
  // intention to restrict, and a parse failure must never be resolved by
  // widening. The rejected entries are logged so the cause is visible.
  return {
    posture: "allowlist",
    allowedOrigins: allowed,
    rejectedEntries: rejected,
    normalisedEntries: normalised,
  };
}

/**
 * Builds the middleware for a resolved configuration.
 *
 * DENIAL SEMANTICS. A disallowed origin is answered by simply NOT emitting
 * `Access-Control-Allow-Origin`, which is what makes the browser refuse to hand
 * the response to the calling script. It is not answered with 403, and that is
 * a considered choice:
 *
 *   - 403-on-Origin punishes non-browser clients that merely happen to send the
 *     header. curl, some proxies and some SDKs do. Those callers are not
 *     subject to CORS at all, so refusing them enforces nothing and breaks
 *     integrations.
 *   - It reads as an access control while providing none — anyone who wants the
 *     response just omits the `Origin` header. Shipping a check whose only
 *     effect is on honest clients is worse than shipping no check, because it
 *     gets counted as protection in review.
 *
 * The callback is also never invoked with an Error. `cors` forwards that
 * straight to `next(err)` and it would surface through `errorHandler` as a 500,
 * turning a routine policy decision into an alert and an error-rate spike.
 */
export function createCorsMiddleware(config: CorsConfiguration): RequestHandler {
  if (config.posture === "unrestricted") {
    // Byte-identical to the previous `app.use(cors())`: `Access-Control-Allow-Origin: *`.
    return cors();
  }

  const allowed = new Set(config.allowedOrigins);

  const options: CorsOptions = {
    origin(requestOrigin, callback) {
      // No `Origin` header at all: same-origin navigation, curl, or a
      // server-to-server call. There is no cross-origin read to police, and
      // `cors` emits no ACAO header for an absent origin anyway. Denying here
      // would break every non-browser caller of a public calculation API while
      // protecting nothing.
      if (requestOrigin === undefined || requestOrigin.length === 0) {
        callback(null, true);
        return;
      }

      // Exact string match against the normalised list. No wildcards, no suffix
      // matching: `endsWith(".example.com")` also matches
      // `https://evil-example.com` and is a recurring source of real bypasses.
      callback(null, allowed.has(requestOrigin));
    },

    // Deliberately NOT set: `credentials`. See the module comment.

    // `methods`, `allowedHeaders` and `optionsSuccessStatus` are left at the
    // library defaults so an ALLOWED origin behaves exactly as it did before
    // this change. The default `allowedHeaders` reflects the browser's
    // `Access-Control-Request-Headers`, which is what lets a preflight for
    // `Authorization` succeed once INVESTSCAPE_FF_REQUIRE_ENGINE_AUTH is on.
  };

  return cors(options);
}

/** One-line startup summary. Prints configuration STATE, never a secret. */
export function describeCorsPosture(config: CorsConfiguration): string {
  if (config.posture === "unrestricted") return "unrestricted (all origins)";
  const count = config.allowedOrigins.length;
  return `allowlist (${count} origin${count === 1 ? "" : "s"})`;
}

/**
 * Emits the startup warnings for a configuration.
 *
 * Separated from `resolveCorsConfiguration` so the resolver stays pure and
 * testable, and so the composition root decides when the noise happens.
 */
export function logCorsConfiguration(config: CorsConfiguration): void {
  if (config.posture === "unrestricted") {
    console.warn(
      `⚠️  CORS IS UNRESTRICTED: ${CORS_ALLOWED_ORIGINS_VAR} is not set, so every origin ` +
        "is allowed to read every response, including /v1/lighthouse. This preserves the " +
        "pre-existing behaviour of this service and is acceptable only while the /v1 " +
        "engines are unauthenticated and stateless. Set " +
        `${CORS_ALLOWED_ORIGINS_VAR} to a comma-separated list of exact origins ` +
        "(e.g. https://app.investscape.ca,http://localhost:5173) before this service " +
        "serves anything session-bearing.",
    );
    return;
  }

  for (const [original, normalisedOrigin] of config.normalisedEntries) {
    console.warn(
      `[cors] normalised allow-list entry "${original}" to origin "${normalisedOrigin}" ` +
        "(browsers only ever send scheme://host[:port])",
    );
  }

  for (const entry of config.rejectedEntries) {
    console.error(
      `[cors] IGNORING unusable ${CORS_ALLOWED_ORIGINS_VAR} entry "${entry}": not an ` +
        "http(s) origin. It will never match; a literal \"*\" is not accepted here — " +
        `unset ${CORS_ALLOWED_ORIGINS_VAR} entirely if you intend to allow all origins.`,
    );
  }

  if (config.allowedOrigins.length === 0) {
    console.error(
      `[cors] ${CORS_ALLOWED_ORIGINS_VAR} is set but produced ZERO usable origins. ` +
        "Every cross-origin browser read will be blocked. This is fail-closed on " +
        "purpose — a parse failure is never resolved by allowing everything.",
    );
  }
}
