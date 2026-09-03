/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Rate limiting for the /v1/lighthouse/* route family.
 *
 * This module MOUNTS NOTHING. It exports a factory; wiring it into
 * `bootstrap.ts` is a separate, explicit decision, exactly like
 * `stage1/launchRoute.ts`.
 *
 * ============================================================================
 * WHAT THIS DOES NOT PROTECT AGAINST. READ BEFORE RELYING ON IT.
 * ============================================================================
 * The default store is a per-PROCESS, in-memory counter. It therefore does NOT
 * rate limit a horizontally scaled deployment:
 *
 *   - With N instances behind a load balancer, a caller gets roughly N x the
 *     configured limit, because each instance counts only what it sees.
 *   - Every restart, rolling deploy, crash, or scale-out event resets every
 *     counter to zero. A patient attacker can wait for one.
 *   - It is close to useless against a DISTRIBUTED source. An attacker with
 *     10,000 addresses gets 10,000 independent budgets; per-source limiting is
 *     structurally unable to see that as one attacker.
 *   - It cannot limit anything the request never reaches. Bandwidth and
 *     connection exhaustion belong at the edge, not here.
 *
 * What it honestly IS good for:
 *   - a single-process deployment, which is what this service is today;
 *   - blunting a naive guessing loop or credential-stuffing script from one
 *     source, which is the realistic threat against /launch/redeem;
 *   - putting a ceiling on an accidental client retry storm, which is the
 *     realistic non-malicious failure.
 *
 * It is NOT a substitute for an edge/WAF rate limit and it is NOT a defence
 * against a botnet. When this service is scaled out, implement `RateLimitStore`
 * against Redis (INCR + PEXPIRE, or one Lua script) and pass it to the factory.
 * No call site changes — that is the whole point of the seam, and it mirrors
 * `service-auth/nonceStore.ts`, which has the same single-process caveat.
 *
 * ---------------------------------------------------------------------------
 * WHY FIXED WINDOW AND NOT TOKEN BUCKET
 * ---------------------------------------------------------------------------
 * Token bucket gives smoother behaviour, and if this were only ever going to be
 * in-process it would be the nicer algorithm. It is rejected because of where
 * this code is going: a fixed window is the only variant a Redis backend can
 * implement with a single atomic round trip (`INCR` then `PEXPIRE` on first
 * hit). A token bucket has to persist a fractional token count plus a
 * last-refill timestamp and then read-modify-write both, which across processes
 * is a lost-update race unless it is wrapped in a Lua script or WATCH loop.
 * Choosing the algorithm that stays atomic when the backend is swapped is worth
 * more than the smoother shaping.
 *
 * The cost of that choice, stated plainly: a fixed window permits a burst of
 * nearly 2x `limit` in an arbitrarily short span. A caller can spend the rest
 * of one window's budget in its closing millisecond and a full budget in the
 * opening millisecond of the next — `2 * limit - 1` requests, effectively at
 * once, against a rule that reads as `limit` per window. That is a known and
 * accepted property, not an oversight; the boundary-burst test pins it so it
 * cannot change silently. If that burst is unacceptable for a given route, the
 * answer is a smaller window, not a different comment.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT BEHIND A FEATURE FLAG
 * ---------------------------------------------------------------------------
 * Every flag in `config/featureFlags.ts` defaults to disabled because absence
 * of configuration must never grant a capability. A rate limiter inverts that
 * rule: it is a restriction, not a capability, so "unconfigured" must mean
 * PROTECTED, not unprotected. Gating it behind a disabled-by-default flag would
 * ship a limiter that limits nothing, which is strictly worse than not having
 * one — it would read as protection in review while being a no-op in
 * production. The gate here is that nothing is mounted: the limiter is inert
 * until a composition root deliberately installs it, and active the moment it
 * does. There is deliberately no env-var kill switch, because a kill switch on
 * a protective control is a one-variable outage waiting to happen.
 *
 * A rate limiter is also never an authorization control. It bounds how OFTEN a
 * caller may ask; it says nothing about whether they may. `requireSession` and
 * `requireOperatingContext` still run, and still fail closed, regardless of
 * what this decides.
 */

import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/** A fixed-window budget: at most `limit` requests per `windowMs` per caller. */
export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * Per-route budgets. Separate route families get separate, independently
 * tunable bounds — a write endpoint that spends an outbound HTTP call has no
 * business sharing a budget with a cheap read.
 */
export const LIGHTHOUSE_RATE_LIMITS = {
  /**
   * POST /v1/lighthouse/launch/redeem — the tightest bound in the family.
   *
   * A legitimate browser calls this EXACTLY ONCE per launch: the code is
   * single-use, and `redeemLaunchSession` deliberately never retries it. So
   * anything past a handful per minute from one source is either a client retry
   * bug or a code-guessing loop, and both should be stopped. It is also the
   * most expensive route we have — each call spends a signed outbound request
   * against Relationship OS, so an unbounded caller here burns another team's
   * capacity as well as ours.
   */
  launchRedeem: { limit: 5, windowMs: 60_000 },

  /**
   * Read endpoints (analysis lookup, status polling). Loose enough that a UI
   * polling once a second never trips it, tight enough that a scraping loop
   * from one address does.
   */
  read: { limit: 120, windowMs: 60_000 },

  /**
   * Inbound service-to-service callbacks. Higher than a browser budget because
   * one peer legitimately drives many analyses concurrently. This is a backstop
   * against a broken retry loop on their side; the HMAC signature and nonce
   * store remain the actual authentication controls.
   */
  serviceCallback: { limit: 300, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitDecision {
  /** Only an explicit `true` is an allow. Anything else is treated as a deny. */
  readonly allowed: boolean;
  /** Whole seconds until this caller's window resets. Never placed in a body. */
  readonly retryAfterSeconds: number;
}

/**
 * The swappable backend seam, shaped like `NonceStore.consume`.
 *
 * `hit` records one request and returns the verdict in ONE call. The rule is
 * passed in rather than held by the store so the whole test-and-increment can
 * happen inside the backend — a Redis implementation is `INCR` plus a
 * first-hit `PEXPIRE`, with no read-modify-write window for two processes to
 * race through. Splitting this into `get` then `set` would look tidier and
 * would be wrong.
 *
 * Implementations MAY throw. Callers must treat a throw as a denial.
 */
export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule, nowMs: number): Promise<RateLimitDecision>;
}

/**
 * Default ceiling on tracked keys. At ~120 bytes per entry this is a couple of
 * megabytes, which is affordable, and it is large enough that evicting a live
 * counter costs an attacker far more requests than the limit they would dodge
 * (see `#evictToFit`).
 */
export const DEFAULT_MAX_TRACKED_KEYS = 10_000;

/**
 * How many entries a single insertion may sweep for expiry. Bounded on purpose:
 * a full O(n) sweep on every request would itself be the DoS we are trying to
 * prevent. The map is kept in window-start order, so the front is where expired
 * entries collect and a small budget reclaims them quickly.
 */
const SWEEP_BUDGET = 64;

interface WindowEntry {
  count: number;
  readonly resetAtMs: number;
}

/**
 * In-memory fixed-window store for a single process.
 *
 * BOUNDED ON PURPOSE. An unbounded keyed map is itself a denial-of-service
 * vector: an attacker rotating source addresses inserts a new key per request
 * and exhausts the heap, taking down the calculation engines that share this
 * process. So the map has a hard ceiling and reclaims expired entries as it
 * goes.
 *
 * See `#evictToFit` for the honest tradeoff taken when the ceiling is hit.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  // Explicit fields, not TS parameter properties — Node's strip-only type
  // stripping rejects those. Same style as SqlNonceStore.
  readonly #windows = new Map<string, WindowEntry>();
  readonly #maxKeys: number;

  constructor(maxKeys: number = DEFAULT_MAX_TRACKED_KEYS) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new RangeError("maxKeys must be a positive integer");
    }
    this.#maxKeys = maxKeys;
  }

  async hit(key: string, rule: RateLimitRule, nowMs: number): Promise<RateLimitDecision> {
    const existing = this.#windows.get(key);

    if (existing !== undefined && existing.resetAtMs > nowMs) {
      existing.count += 1;
      return {
        allowed: existing.count <= rule.limit,
        retryAfterSeconds: secondsUntil(existing.resetAtMs, nowMs),
      };
    }

    // Opening a new window is the ONLY path that can grow the map, so it is the
    // only path that pays for housekeeping. Deleting first (rather than
    // overwriting) re-inserts at the back, which is what keeps the map ordered
    // by window start and makes the front-of-map sweep and eviction correct.
    if (existing !== undefined) this.#windows.delete(key);
    this.#sweep(nowMs);
    this.#evictToFit();

    const resetAtMs = nowMs + rule.windowMs;
    this.#windows.set(key, { count: 1, resetAtMs });
    return {
      // Written as a comparison rather than a hardcoded `true` so a rule with
      // limit 0 denies everything, which is a legitimate way to close a route.
      allowed: 1 <= rule.limit,
      retryAfterSeconds: secondsUntil(resetAtMs, nowMs),
    };
  }

  /** Number of tracked keys. Exposed for tests and health surfaces only. */
  get size(): number {
    return this.#windows.size;
  }

  #sweep(nowMs: number): void {
    let scanned = 0;
    for (const [key, entry] of this.#windows) {
      if (scanned >= SWEEP_BUDGET) break;
      scanned += 1;
      if (entry.resetAtMs <= nowMs) this.#windows.delete(key);
    }
  }

  /**
   * Evict from the front (oldest window start) until the map fits.
   *
   * THE TRADEOFF, STATED HONESTLY. There are two options when the table is full
   * and neither is clean:
   *
   *   (a) Refuse the new key — fail closed. An attacker then fills the table
   *       with junk keys once and every subsequent NEW caller is 429'd. That
   *       converts a cheap flood into a total outage for legitimate users. It
   *       is "fail closed" in the letter and a self-inflicted denial of service
   *       in practice.
   *   (b) Evict the oldest entry. An attacker can flush their own counter early
   *       and get a fresh budget.
   *
   * (b) is chosen because its abuse is self-defeating at these numbers: to
   * evict their own entry an attacker must push `maxKeys` distinct keys
   * through, i.e. ~10,000 requests, to buy back a budget of 5. They would have
   * been better off just sending the 10,000 requests. (a) by contrast costs the
   * attacker almost nothing and costs everyone else everything.
   *
   * Note this is a CAPACITY policy and is deliberately different from the
   * limiter's error policy: a limiter that THROWS still denies (see
   * `createRateLimiter`). Full table and broken limiter are not the same
   * failure and do not get the same answer.
   */
  #evictToFit(): void {
    while (this.#windows.size >= this.#maxKeys) {
      const oldest = this.#windows.keys().next();
      // size >= 1 guarantees a key exists; the guard is only here so a future
      // change cannot turn this into an infinite loop.
      if (oldest.done === true) break;
      this.#windows.delete(oldest.value);
    }
  }
}

function secondsUntil(resetAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
}

/** Upper bound on characters hashed into a key. See `hashKey`. */
const MAX_KEY_INPUT_CHARS = 256;

/** Sanity ceiling on the Retry-After header, so a bad store cannot emit nonsense. */
const MAX_RETRY_AFTER_SECONDS = 3600;

/** The one message every denial gets, whatever the cause. */
const DENIAL_MESSAGE = "Too many requests";

export type CallerKeySource = "session" | "forwarded" | "socket";

export type CallerKeyResult =
  | { readonly ok: true; readonly key: string; readonly source: CallerKeySource }
  | { readonly ok: false; readonly reason: "no_caller_identity" };

export interface CallerKeyOptions {
  /** Namespace. Two rules with different scopes can never share a counter. */
  readonly scope: string;
  /**
   * How many proxies YOU operate in front of this process, each of which
   * appends one entry to X-Forwarded-For.
   *
   * DEFAULT 0, MEANING X-FORWARDED-FOR IS IGNORED ENTIRELY. This is the whole
   * threat model of this file in one option:
   *
   *   X-Forwarded-For is written by whoever is talking to us. Any client can
   *   send `X-Forwarded-For: 203.0.113.<random>` and rotate it every request.
   *   Keying on it without a verified proxy chain does not weaken the limiter,
   *   it DELETES it — and worse, it hands the attacker an unbounded key space
   *   pointed straight at the memory bound above.
   *
   * A boolean would be the wrong shape here. "Trust the header" is not a
   * decision anyone can make correctly without knowing how many hops they
   * control, so the option demands that number. If you cannot state it, you are
   * not in a position to turn this on.
   *
   * With `trustedProxyHops = n`, the client address is the n-th entry from the
   * right, because each of our proxies appended the address IT observed. Every
   * entry to the left of that is client-written fiction and is ignored. If the
   * chain is shorter than `n` the proxies did not behave as declared, so the
   * header is discarded and the socket peer is used instead.
   *
   * Note this is independent of Express's own `trust proxy` setting, which this
   * app does not enable. As long as it stays off, `req.ip` is the socket peer
   * and cannot be influenced by a header at all.
   */
  readonly trustedProxyHops?: number;
}

/**
 * Reads a verified session identity if authentication middleware already ran.
 *
 * Read structurally rather than by importing `auth/middleware.ts`, on purpose:
 * this module stays standalone and does not break if that file's global Request
 * augmentation is refactored. It is also read-only — nothing here writes to the
 * request.
 */
function verifiedActorRef(req: Request): string | null {
  const session = (req as { lighthouseSession?: { actorRef?: unknown } }).lighthouseSession;
  const actorRef = session?.actorRef;
  return typeof actorRef === "string" && actorRef.length > 0 ? actorRef : null;
}

/**
 * Strips a port and IPv6 brackets from a forwarded address token.
 *
 * Not cosmetic. Some proxies append `203.0.113.7:51514`, and the source port
 * changes on every TCP connection, so an unnormalised key would be unique per
 * request and the limiter would silently count to one forever.
 */
function normalizeAddress(raw: string): string {
  const value = raw.trim();

  // "[2001:db8::1]:443" -> "2001:db8::1"
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) return bracketed[1];

  // "203.0.113.7:51514" -> "203.0.113.7". Exactly one colon means IPv4 + port;
  // a bare IPv6 literal has two or more and must be left alone.
  const firstColon = value.indexOf(":");
  if (firstColon !== -1 && value.indexOf(":", firstColon + 1) === -1) {
    return value.slice(0, firstColon);
  }

  return value;
}

/**
 * Picks the client address out of an X-Forwarded-For chain, given how many
 * trailing entries our own proxies wrote. Returns null when the chain is
 * absent, empty, or shorter than declared — all of which mean "do not trust
 * this".
 */
function clientFromForwardedFor(header: string | undefined, trustedHops: number): string | null {
  if (typeof header !== "string" || header.length === 0) return null;

  const chain = header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // One trusted proxy => our proxy appended the real client, so it is the last
  // entry (index length - 1). Two => index length - 2. Hence length - hops.
  const index = chain.length - trustedHops;
  if (index < 0) return null;

  const candidate = chain[index];
  return candidate === undefined ? null : normalizeAddress(candidate);
}

/**
 * Hashes the caller identity into the storage key.
 *
 * Two practical reasons, neither of which is "for security" — the input space
 * is small enough to brute force and this is not a secret:
 *
 *   1. Every stored key becomes a fixed 64 characters, so a caller cannot
 *      inflate per-entry memory by sending a long header value.
 *   2. The store never holds a raw IP address or actor id. Both are personal
 *      data, and a limiter has no business being the place they leak from. Same
 *      reasoning as `hashNonce` in service-auth/nonceStore.ts.
 *
 * The scope is inside the hash, which is what makes two route configs
 * structurally incapable of sharing a counter.
 */
function hashKey(scope: string, kind: string, value: string): string {
  return createHash("sha256")
    .update(`${scope}\u0000${kind}\u0000${value.slice(0, MAX_KEY_INPUT_CHARS)}`)
    .digest("hex");
}

/**
 * Derives the counter key for a request.
 *
 * Order of preference:
 *   1. A verified session actor. Cryptographically established by
 *      `requireSession`, survives NAT and mobile IP changes, and does not
 *      punish everyone behind one corporate egress address. Only available if
 *      this middleware is mounted AFTER authentication.
 *   2. The client address from X-Forwarded-For, ONLY when a trusted hop count
 *      was declared.
 *   3. `req.ip`, the socket peer. With Express's `trust proxy` off (this app's
 *      setting) that is `req.socket.remoteAddress` and no header can change it.
 *
 * Exported because it is the security-critical half of this file and deserves
 * to be tested directly rather than only through the middleware.
 */
export function resolveCallerKey(req: Request, options: CallerKeyOptions): CallerKeyResult {
  const actorRef = verifiedActorRef(req);
  if (actorRef !== null) {
    return { ok: true, key: hashKey(options.scope, "actor", actorRef), source: "session" };
  }

  const trustedHops = options.trustedProxyHops ?? 0;
  if (trustedHops > 0) {
    const forwarded = clientFromForwardedFor(req.header("x-forwarded-for"), trustedHops);
    if (forwarded !== null && forwarded.length > 0) {
      return { ok: true, key: hashKey(options.scope, "ip", forwarded), source: "forwarded" };
    }
    // Fall through rather than fail: a chain that does not match the declared
    // topology is a misconfiguration, and the socket peer is still a real,
    // unspoofable identity.
  }

  const socketIp = req.ip;
  if (typeof socketIp !== "string" || socketIp.length === 0) {
    // `req.ip` is undefined when the socket is already destroyed. A caller we
    // cannot identify is a caller we cannot count, and something we cannot
    // count must not be waved through.
    return { ok: false, reason: "no_caller_identity" };
  }

  return {
    ok: true,
    key: hashKey(options.scope, "ip", normalizeAddress(socketIp)),
    source: "socket",
  };
}

export type RateLimitDenialReason = "over_limit" | "no_caller_identity" | "limiter_error";

export interface RateLimitDenial {
  readonly scope: string;
  readonly reason: RateLimitDenialReason;
  /** The hashed key, or null when no identity could be derived. Never a raw address. */
  readonly key: string | null;
  readonly method: string;
  readonly path: string;
}

export interface RateLimiterOptions {
  /** Counter namespace. Give each route family its own; it is baked into the key. */
  readonly scope: string;
  /** The budget. Use a `LIGHTHOUSE_RATE_LIMITS` preset or supply your own. */
  readonly rule: RateLimitRule;
  /**
   * Backend. Defaults to a fresh single-process in-memory store — see the
   * caveats at the top of this file. Pass ONE shared store across limiters if
   * you want a single global memory bound; scopes keep their counters separate
   * either way.
   */
  readonly store?: RateLimitStore;
  /** Injectable clock, so tests need no real timers. Defaults to wall time. */
  readonly now?: () => Date;
  /** See `CallerKeyOptions.trustedProxyHops`. Defaults to 0 (header ignored). */
  readonly trustedProxyHops?: number;
  /**
   * Observability seam for denials. Deliberately a callback rather than an
   * `AuditSink` import, so this module keeps no dependency on the audit
   * subsystem and the composition root decides what a denial is worth.
   * Exceptions thrown here are swallowed — telemetry must never be able to
   * turn a denial into an allow, or into a 500.
   */
  readonly onDenied?: (denial: RateLimitDenial) => void;
}

type Verdict =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly reason: RateLimitDenialReason;
      readonly retryAfterSeconds: number;
      readonly key: string | null;
    };

function validateOptions(options: RateLimiterOptions): void {
  // Thrown at construction, i.e. at startup, never at request time. A
  // misconfigured limiter must break the boot loudly rather than quietly
  // allowing traffic through a rule that makes no sense.
  if (typeof options.scope !== "string" || options.scope.length === 0) {
    throw new RangeError("rate limiter scope must be a non-empty string");
  }
  if (!Number.isInteger(options.rule.limit) || options.rule.limit < 0) {
    throw new RangeError("rate limit `limit` must be a non-negative integer");
  }
  if (!Number.isInteger(options.rule.windowMs) || options.rule.windowMs < 1) {
    throw new RangeError("rate limit `windowMs` must be a positive integer");
  }
  const hops = options.trustedProxyHops ?? 0;
  if (!Number.isInteger(hops) || hops < 0) {
    throw new RangeError("trustedProxyHops must be a non-negative integer");
  }
}

function retryAfterFor(raw: unknown, fallbackSeconds: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) return fallbackSeconds;
  return Math.min(Math.ceil(raw), MAX_RETRY_AFTER_SECONDS);
}

/**
 * Builds the middleware.
 *
 * Mount it as early as possible in the route's chain — ahead of body parsing
 * and any database work — so a flood is rejected before it costs anything. The
 * one exception is when you want session-keyed limiting, which requires
 * mounting after `requireSession`; see `resolveCallerKey`.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  validateOptions(options);

  const scope = options.scope;
  const rule = options.rule;
  const store = options.store ?? new InMemoryRateLimitStore();
  const now = options.now ?? (() => new Date());
  const trustedProxyHops = options.trustedProxyHops ?? 0;
  const fallbackRetryAfterSeconds = Math.max(1, Math.ceil(rule.windowMs / 1000));

  async function evaluate(req: Request): Promise<Verdict> {
    try {
      const resolved = resolveCallerKey(req, { scope, trustedProxyHops });
      if (!resolved.ok) {
        return {
          allow: false,
          reason: "no_caller_identity",
          retryAfterSeconds: fallbackRetryAfterSeconds,
          key: null,
        };
      }

      const decision = await store.hit(resolved.key, rule, now().getTime());

      // `decision.allowed === true`, not `!decision.allowed`: a third-party
      // store returning a malformed or missing value must land on deny. If
      // `decision` is not an object at all this throws, and the catch below
      // also denies.
      if (decision.allowed === true) return { allow: true };

      return {
        allow: false,
        reason: "over_limit",
        retryAfterSeconds: retryAfterFor(decision.retryAfterSeconds, fallbackRetryAfterSeconds),
        key: resolved.key,
      };
    } catch (error) {
      // FAIL CLOSED. If the limiter itself is broken we do not know whether
      // this caller is inside their budget, and "we do not know" must not
      // resolve to "yes". A limiter that opens under load is a limiter that is
      // absent exactly when it is needed, since load is precisely what breaks a
      // Redis backend.
      //
      // Logged, not returned: the caller learns nothing about why.
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[lighthouse] rate limiter failed on ${req.method} ${req.path}, denying: ${reason}`,
      );
      return {
        allow: false,
        reason: "limiter_error",
        retryAfterSeconds: fallbackRetryAfterSeconds,
        key: null,
      };
    }
  }

  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const verdict = await evaluate(req);

    if (verdict.allow) {
      // Outside the try above on purpose. An exception thrown by a DOWNSTREAM
      // handler is that handler's problem and must reach the error middleware
      // as itself — it must never be relabelled as a rate-limit denial.
      next();
      return;
    }

    // Retry-After is the one number that goes out, and it is conventional
    // (RFC 9110 §10.2.3) rather than a leak: the window length is published
    // policy, not a secret. It is a header and not a body field so an
    // unauthenticated caller gets no structured quota data to calibrate
    // against, which is the actual concern.
    res.setHeader("Retry-After", String(verdict.retryAfterSeconds));

    try {
      options.onDenied?.({
        scope,
        reason: verdict.reason,
        key: verdict.key,
        method: req.method,
        path: req.path,
      });
    } catch {
      // Telemetry failure is not the caller's business and must not stop the
      // 429 from being sent.
    }

    // One opaque message for every cause. Over limit, unidentifiable caller,
    // and broken limiter are indistinguishable from outside — same reasoning as
    // requireSession's single "Authentication required", so the response cannot
    // be used as an oracle for probing the limiter's state or its thresholds.
    res.status(429).json({ error: { message: DENIAL_MESSAGE } });
  };
}
