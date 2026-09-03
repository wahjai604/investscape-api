/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * Rate limiter tests.
 *
 * Hermetic by construction: no database, no network, no real timers. The clock
 * is injected, so "a minute passes" is one synchronous line and the suite runs
 * in milliseconds. A rate limiter tested with `setTimeout` is a flaky test
 * waiting to happen, and a flaky security test gets deleted eventually.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  InMemoryRateLimitStore,
  LIGHTHOUSE_RATE_LIMITS,
  createRateLimiter,
  resolveCallerKey,
  type RateLimitDecision,
  type RateLimitDenial,
  type RateLimitRule,
  type RateLimitStore,
} from "./rateLimit.ts";

const START_MS = new Date("2026-09-01T12:00:00.000Z").getTime();

/** A hand-cranked clock. The only source of time in this file. */
function testClock(startMs: number = START_MS) {
  let current = startMs;
  return {
    now: (): Date => new Date(current),
    advance(ms: number): void {
      current += ms;
    },
  };
}

interface RequestInit {
  readonly ip?: string | undefined;
  readonly headers?: Record<string, string>;
  readonly method?: string;
  readonly path?: string;
  readonly actorRef?: string;
}

/**
 * The smallest object the limiter actually touches: `ip`, `header()`, `method`,
 * `path`, and possibly `lighthouseSession`. Building this by hand rather than
 * booting Express keeps the suite hermetic and makes the spoofing tests
 * explicit about exactly what an attacker controls.
 */
function fakeRequest(init: RequestInit = {}): Request {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  const req = {
    ip: init.ip,
    method: init.method ?? "POST",
    path: init.path ?? "/launch/redeem",
    headers,
    header(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
    ...(init.actorRef === undefined ? {} : { lighthouseSession: { actorRef: init.actorRef } }),
  };
  return req as unknown as Request;
}

interface Captured {
  statusCode: number | null;
  body: unknown;
  headers: Record<string, string>;
}

function fakeResponse(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: null, body: undefined, headers: {} };
  const res = {
    setHeader(name: string, value: string | number): unknown {
      captured.headers[name.toLowerCase()] = String(value);
      return res;
    },
    status(code: number): unknown {
      captured.statusCode = code;
      return res;
    },
    json(body: unknown): unknown {
      captured.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, captured };
}

interface CallResult {
  readonly passed: boolean;
  readonly captured: Captured;
}

async function call(middleware: RequestHandler, req: Request): Promise<CallResult> {
  const { res, captured } = fakeResponse();
  let passed = false;
  const next: NextFunction = () => {
    passed = true;
  };
  await middleware(req, res, next);
  return { passed, captured };
}

/** Sends `count` requests and returns the outcome of each. */
async function callTimes(
  middleware: RequestHandler,
  req: Request,
  count: number,
): Promise<readonly CallResult[]> {
  const results: CallResult[] = [];
  for (let i = 0; i < count; i += 1) {
    results.push(await call(middleware, req));
  }
  return results;
}

const TIGHT: RateLimitRule = { limit: 3, windowMs: 60_000 };

// --- The basic contract ----------------------------------------------------

test("requests under the limit are passed through untouched", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  for (const result of await callTimes(limiter, req, TIGHT.limit)) {
    assert.equal(result.passed, true);
    assert.equal(result.captured.statusCode, null, "an allowed request writes no response");
  }
});

test("the request past the limit is refused with 429", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  await callTimes(limiter, req, TIGHT.limit);
  const overflow = await call(limiter, req);

  assert.equal(overflow.passed, false, "an over-limit request must never reach the handler");
  assert.equal(overflow.captured.statusCode, 429);
});

test("every subsequent request in the same window is also refused", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  const results = await callTimes(limiter, req, TIGHT.limit + 5);
  assert.equal(results.filter((r) => r.passed).length, TIGHT.limit);
});

// --- What the 429 is allowed to say ----------------------------------------

test("the 429 body is a single opaque message and nothing else", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  await callTimes(limiter, req, TIGHT.limit);
  const { captured } = await call(limiter, req);

  // Shape matches requireSession's `{ error: { message } }` exactly.
  assert.deepEqual(captured.body, { error: { message: "Too many requests" } });
});

test("the 429 body leaks neither remaining quota nor reset time", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  await callTimes(limiter, req, TIGHT.limit);
  const { captured } = await call(limiter, req);
  const serialised = JSON.stringify(captured.body);

  for (const leak of ["remaining", "reset", "limit", "window", "quota", "retry"]) {
    assert.ok(
      !serialised.toLowerCase().includes(leak),
      `429 body leaked "${leak}": ${serialised}`,
    );
  }
  // No numbers at all: neither the threshold nor the window length.
  assert.ok(!/\d/.test(serialised), `429 body leaked a number: ${serialised}`);
});

test("Retry-After is set as a header and is a positive integer", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  await callTimes(limiter, req, TIGHT.limit);
  const { captured } = await call(limiter, req);

  const retryAfter = captured.headers["retry-after"];
  assert.match(retryAfter ?? "", /^[1-9][0-9]*$/, "Retry-After must be whole seconds >= 1");
  assert.ok(Number(retryAfter) <= 60, "Retry-After cannot exceed the window it belongs to");
});

test("an allowed request is given no rate-limit headers at all", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const { captured } = await call(limiter, fakeRequest({ ip: "203.0.113.7" }));

  assert.deepEqual(captured.headers, {}, "no X-RateLimit-* oracle on the happy path either");
});

// --- Window expiry ---------------------------------------------------------

test("the counter resets once the window has elapsed", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  await callTimes(limiter, req, TIGHT.limit);
  assert.equal((await call(limiter, req)).passed, false);

  clock.advance(TIGHT.windowMs);
  assert.equal((await call(limiter, req)).passed, true, "a fresh window starts a fresh budget");
});

test("time passing inside the window does not reset the counter", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  for (let i = 0; i < TIGHT.limit; i += 1) {
    assert.equal((await call(limiter, req)).passed, true);
    clock.advance(1_000);
  }
  assert.equal((await call(limiter, req)).passed, false);
});

test("Retry-After shrinks as the window drains", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  await callTimes(limiter, req, TIGHT.limit);
  const early = Number((await call(limiter, req)).captured.headers["retry-after"]);
  clock.advance(30_000);
  const late = Number((await call(limiter, req)).captured.headers["retry-after"]);

  assert.ok(late < early, `expected ${late} < ${early}`);
  assert.ok(late >= 1);
});

test("KNOWN LIMITATION: a fixed window permits a near-2x burst across the boundary", async () => {
  // Pinned deliberately. This is the documented cost of choosing fixed window
  // over token bucket, and it must fail loudly if anyone "fixes" the algorithm
  // without updating the header comment that promises this behaviour.
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const req = fakeRequest({ ip: "203.0.113.7" });

  // One request opens the window. The window is anchored to this hit, not to a
  // wall-clock boundary, which is what a Redis INCR-with-TTL would also do.
  assert.equal((await call(limiter, req)).passed, true);

  // Spend the rest of the budget in the closing instant of that window...
  clock.advance(TIGHT.windowMs - 1);
  const endOfWindow = await callTimes(limiter, req, TIGHT.limit - 1);

  // ...then one millisecond later the window rolls and the budget is back.
  clock.advance(1);
  const startOfNext = await callTimes(limiter, req, TIGHT.limit);

  const allowedInOneMillisecond =
    endOfWindow.filter((r) => r.passed).length + startOfNext.filter((r) => r.passed).length;
  assert.equal(
    allowedInOneMillisecond,
    TIGHT.limit * 2 - 1,
    "5 requests in 1ms against a 3-per-minute rule is expected, not a regression",
  );
});

// --- Key independence ------------------------------------------------------

test("separate source addresses have independent budgets", async () => {
  const clock = testClock();
  const store = new InMemoryRateLimitStore();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, store, now: clock.now });

  await callTimes(limiter, fakeRequest({ ip: "203.0.113.7" }), TIGHT.limit + 2);
  const other = await call(limiter, fakeRequest({ ip: "198.51.100.9" }));

  assert.equal(other.passed, true, "one exhausted caller must not lock out everyone else");
});

test("separate route scopes have independent budgets even on one shared store", async () => {
  const clock = testClock();
  const store = new InMemoryRateLimitStore();
  const redeem = createRateLimiter({
    scope: "launch.redeem",
    rule: LIGHTHOUSE_RATE_LIMITS.launchRedeem,
    store,
    now: clock.now,
  });
  const read = createRateLimiter({
    scope: "analysis.read",
    rule: LIGHTHOUSE_RATE_LIMITS.read,
    store,
    now: clock.now,
  });
  const req = fakeRequest({ ip: "203.0.113.7" });

  // Burn the strict redeem budget completely.
  const redeemResults = await callTimes(redeem, req, LIGHTHOUSE_RATE_LIMITS.launchRedeem.limit + 3);
  assert.equal(redeemResults.at(-1)?.passed, false);

  // The loose read budget for the SAME caller is untouched.
  assert.equal((await call(read, req)).passed, true);
});

test("the stricter route config actually refuses earlier than the looser one", async () => {
  const clock = testClock();
  const store = new InMemoryRateLimitStore();
  const strict = createRateLimiter({
    scope: "strict",
    rule: { limit: 2, windowMs: 60_000 },
    store,
    now: clock.now,
  });
  const loose = createRateLimiter({
    scope: "loose",
    rule: { limit: 10, windowMs: 60_000 },
    store,
    now: clock.now,
  });
  const req = fakeRequest({ ip: "203.0.113.7" });

  const strictResults = await callTimes(strict, req, 5);
  const looseResults = await callTimes(loose, req, 5);

  assert.equal(strictResults.filter((r) => r.passed).length, 2);
  assert.equal(looseResults.filter((r) => r.passed).length, 5);
});

test("the redeem preset is strictly tighter than the read preset", () => {
  const redeem = LIGHTHOUSE_RATE_LIMITS.launchRedeem;
  const read = LIGHTHOUSE_RATE_LIMITS.read;
  assert.equal(redeem.windowMs, read.windowMs, "comparing rates needs a common window");
  assert.ok(redeem.limit < read.limit, "the single-use-code endpoint must be the tightest");
});

// --- Spoofing --------------------------------------------------------------

test("a rotating X-Forwarded-For does NOT change the key under the default config", async () => {
  // The headline attack. If the limiter keyed on X-Forwarded-For by default,
  // this loop would pass forever and the limiter would be decorative.
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });

  const results: CallResult[] = [];
  for (let i = 0; i < TIGHT.limit + 4; i += 1) {
    results.push(
      await call(
        limiter,
        fakeRequest({
          ip: "203.0.113.7",
          headers: { "X-Forwarded-For": `198.51.100.${i}` },
        }),
      ),
    );
  }

  assert.equal(
    results.filter((r) => r.passed).length,
    TIGHT.limit,
    "rotating a client-supplied header must not buy extra budget",
  );
});

test("an identical X-Forwarded-For on two different sockets stays two callers", async () => {
  // The mirror of the above: a shared header value must not merge two real
  // callers into one bucket either, which would let one attacker 429 a victim.
  const clock = testClock();
  const store = new InMemoryRateLimitStore();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, store, now: clock.now });
  const spoof = { "X-Forwarded-For": "203.0.113.7" };

  await callTimes(limiter, fakeRequest({ ip: "198.51.100.1", headers: spoof }), TIGHT.limit + 2);
  const victim = await call(limiter, fakeRequest({ ip: "198.51.100.2", headers: spoof }));

  assert.equal(victim.passed, true);
});

test("the default key is the socket peer, and the header is not read at all", () => {
  const withHeader = resolveCallerKey(
    fakeRequest({ ip: "203.0.113.7", headers: { "X-Forwarded-For": "1.2.3.4, 5.6.7.8" } }),
    { scope: "redeem" },
  );
  const withoutHeader = resolveCallerKey(fakeRequest({ ip: "203.0.113.7" }), { scope: "redeem" });

  assert.ok(withHeader.ok && withoutHeader.ok);
  if (!withHeader.ok || !withoutHeader.ok) return;
  assert.equal(withHeader.source, "socket");
  assert.equal(withHeader.key, withoutHeader.key);
});

test("X-Forwarded-For is honoured only when a trusted hop count is declared", () => {
  const req = fakeRequest({
    ip: "10.0.0.1",
    headers: { "X-Forwarded-For": "9.9.9.9, 203.0.113.7" },
  });

  const ignored = resolveCallerKey(req, { scope: "s" });
  const honoured = resolveCallerKey(req, { scope: "s", trustedProxyHops: 1 });

  assert.ok(ignored.ok && honoured.ok);
  if (!ignored.ok || !honoured.ok) return;
  assert.equal(ignored.source, "socket");
  assert.equal(honoured.source, "forwarded");
  assert.notEqual(ignored.key, honoured.key);
});

test("with one trusted hop the client-written prefix of the chain is ignored", () => {
  // Our proxy appends the address it observed, so the rightmost entry is ours
  // and everything to the left is whatever the client felt like sending.
  const honest = resolveCallerKey(
    fakeRequest({ ip: "10.0.0.1", headers: { "X-Forwarded-For": "203.0.113.7" } }),
    { scope: "s", trustedProxyHops: 1 },
  );
  const lying = resolveCallerKey(
    fakeRequest({
      ip: "10.0.0.1",
      headers: { "X-Forwarded-For": "1.1.1.1, 2.2.2.2, 203.0.113.7" },
    }),
    { scope: "s", trustedProxyHops: 1 },
  );

  assert.ok(honest.ok && lying.ok);
  if (!honest.ok || !lying.ok) return;
  assert.equal(honest.key, lying.key, "injected left-hand entries must not create a new bucket");
});

test("with two trusted hops the address two from the right is used", () => {
  const twoHops = resolveCallerKey(
    fakeRequest({
      ip: "10.0.0.1",
      headers: { "X-Forwarded-For": "9.9.9.9, 203.0.113.7, 10.0.0.9" },
    }),
    { scope: "s", trustedProxyHops: 2 },
  );
  const direct = resolveCallerKey(
    fakeRequest({ ip: "10.0.0.1", headers: { "X-Forwarded-For": "203.0.113.7" } }),
    { scope: "s", trustedProxyHops: 1 },
  );

  assert.ok(twoHops.ok && direct.ok);
  if (!twoHops.ok || !direct.ok) return;
  assert.equal(twoHops.key, direct.key, "both must resolve to 203.0.113.7");
});

test("a chain shorter than the declared hop count falls back to the socket peer", async () => {
  // The proxies did not behave as configured, so the header is discarded. The
  // proof is behavioural: two DIFFERENT single-entry chains from one socket
  // must share one budget.
  const clock = testClock();
  const store = new InMemoryRateLimitStore();
  const limiter = createRateLimiter({
    scope: "redeem",
    rule: { limit: 1, windowMs: 60_000 },
    store,
    trustedProxyHops: 2,
    now: clock.now,
  });

  const first = await call(
    limiter,
    fakeRequest({ ip: "203.0.113.7", headers: { "X-Forwarded-For": "1.1.1.1" } }),
  );
  const second = await call(
    limiter,
    fakeRequest({ ip: "203.0.113.7", headers: { "X-Forwarded-For": "2.2.2.2" } }),
  );

  assert.equal(first.passed, true);
  assert.equal(second.passed, false, "fallback must be the socket peer, not the short chain");
});

test("a forwarded address with a port normalises to the address", () => {
  // Otherwise the ephemeral source port makes every request a new key and the
  // limiter counts to one forever.
  const withPort = resolveCallerKey(
    fakeRequest({ ip: "10.0.0.1", headers: { "X-Forwarded-For": "203.0.113.7:51514" } }),
    { scope: "s", trustedProxyHops: 1 },
  );
  const withoutPort = resolveCallerKey(
    fakeRequest({ ip: "10.0.0.1", headers: { "X-Forwarded-For": "203.0.113.7" } }),
    { scope: "s", trustedProxyHops: 1 },
  );

  assert.ok(withPort.ok && withoutPort.ok);
  if (!withPort.ok || !withoutPort.ok) return;
  assert.equal(withPort.key, withoutPort.key);
});

test("a bracketed IPv6 address with a port normalises, and a bare one survives", () => {
  const bracketed = resolveCallerKey(
    fakeRequest({ ip: "10.0.0.1", headers: { "X-Forwarded-For": "[2001:db8::1]:443" } }),
    { scope: "s", trustedProxyHops: 1 },
  );
  const bare = resolveCallerKey(
    fakeRequest({ ip: "10.0.0.1", headers: { "X-Forwarded-For": "2001:db8::1" } }),
    { scope: "s", trustedProxyHops: 1 },
  );

  assert.ok(bracketed.ok && bare.ok);
  if (!bracketed.ok || !bare.ok) return;
  assert.equal(bracketed.key, bare.key, "a bare IPv6 literal must not be truncated at its colon");
});

test("an over-long forwarded value cannot inflate the stored key", () => {
  const huge = resolveCallerKey(
    fakeRequest({ ip: "10.0.0.1", headers: { "X-Forwarded-For": "a".repeat(8192) } }),
    { scope: "s", trustedProxyHops: 1 },
  );
  assert.ok(huge.ok);
  if (!huge.ok) return;
  assert.match(huge.key, /^[0-9a-f]{64}$/, "keys are fixed-size hashes, whatever the input");
});

// --- Identity precedence ---------------------------------------------------

test("a verified session identity takes precedence over the network address", async () => {
  const clock = testClock();
  const store = new InMemoryRateLimitStore();
  const limiter = createRateLimiter({ scope: "read", rule: TIGHT, store, now: clock.now });
  const sharedIp = "203.0.113.7";

  await callTimes(limiter, fakeRequest({ ip: sharedIp, actorRef: "actor-a" }), TIGHT.limit + 2);
  const other = await call(limiter, fakeRequest({ ip: sharedIp, actorRef: "actor-b" }));

  assert.equal(other.passed, true, "two users behind one NAT must not share a budget");
});

test("one session is one budget across changing network addresses", async () => {
  const clock = testClock();
  const store = new InMemoryRateLimitStore();
  const limiter = createRateLimiter({ scope: "read", rule: TIGHT, store, now: clock.now });

  const results: CallResult[] = [];
  for (let i = 0; i < TIGHT.limit + 2; i += 1) {
    results.push(
      await call(limiter, fakeRequest({ ip: `198.51.100.${i}`, actorRef: "actor-a" })),
    );
  }

  assert.equal(
    results.filter((r) => r.passed).length,
    TIGHT.limit,
    "hopping networks must not refill an authenticated caller's budget",
  );
});

test("the session key is derived from the actorRef, not from anything client-supplied", () => {
  const fromSession = resolveCallerKey(
    fakeRequest({ ip: "203.0.113.7", actorRef: "actor-a" }),
    { scope: "s" },
  );
  const spoofAttempt = resolveCallerKey(
    fakeRequest({
      ip: "203.0.113.7",
      actorRef: "actor-a",
      headers: { "X-Forwarded-For": "9.9.9.9", "X-Operating-Context": "professional" },
    }),
    { scope: "s", trustedProxyHops: 1 },
  );

  assert.ok(fromSession.ok && spoofAttempt.ok);
  if (!fromSession.ok || !spoofAttempt.ok) return;
  assert.equal(fromSession.source, "session");
  assert.equal(spoofAttempt.source, "session", "a header must not displace a verified identity");
  assert.equal(fromSession.key, spoofAttempt.key);
});

test("an empty or non-string actorRef is not accepted as an identity", () => {
  const empty = resolveCallerKey(fakeRequest({ ip: "203.0.113.7", actorRef: "" }), { scope: "s" });
  assert.ok(empty.ok);
  if (!empty.ok) return;
  assert.equal(empty.source, "socket", "a blank session must fall back, not key on nothing");
});

// --- Fail closed -----------------------------------------------------------

test("a caller with no derivable identity is refused, not waved through", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });

  const result = await call(limiter, fakeRequest({ ip: undefined }));

  assert.equal(result.passed, false, "something we cannot count must not be allowed");
  assert.equal(result.captured.statusCode, 429);
});

test("a store that throws denies rather than allows", async () => {
  const clock = testClock();
  const exploding: RateLimitStore = {
    hit(): Promise<RateLimitDecision> {
      throw new Error("redis connection reset");
    },
  };
  const limiter = createRateLimiter({
    scope: "redeem",
    rule: TIGHT,
    store: exploding,
    now: clock.now,
  });

  const result = await call(limiter, fakeRequest({ ip: "203.0.113.7" }));

  assert.equal(result.passed, false, "a broken limiter must fail CLOSED");
  assert.equal(result.captured.statusCode, 429);
});

test("a store that rejects asynchronously also denies", async () => {
  const clock = testClock();
  const rejecting: RateLimitStore = {
    hit: async (): Promise<RateLimitDecision> => {
      await Promise.resolve();
      throw new Error("timeout");
    },
  };
  const limiter = createRateLimiter({
    scope: "redeem",
    rule: TIGHT,
    store: rejecting,
    now: clock.now,
  });

  assert.equal((await call(limiter, fakeRequest({ ip: "203.0.113.7" }))).passed, false);
});

test("an internal failure tells the caller nothing about itself", async () => {
  const clock = testClock();
  const exploding: RateLimitStore = {
    hit(): Promise<RateLimitDecision> {
      throw new Error("redis://cache-01.internal:6379 auth failed");
    },
  };
  const limiter = createRateLimiter({
    scope: "redeem",
    rule: TIGHT,
    store: exploding,
    now: clock.now,
  });

  const { captured } = await call(limiter, fakeRequest({ ip: "203.0.113.7" }));
  const serialised = JSON.stringify(captured.body);

  assert.deepEqual(captured.body, { error: { message: "Too many requests" } });
  for (const leak of ["redis", "cache-01", "6379", "auth"]) {
    assert.ok(!serialised.toLowerCase().includes(leak), `internal detail leaked: ${leak}`);
  }
  assert.match(captured.headers["retry-after"] ?? "", /^[1-9][0-9]*$/);
});

test("a malformed decision from a custom store is a denial, not an allow", async () => {
  const clock = testClock();
  // A backend that returns the wrong shape — a truthy string, a missing field.
  // Only an explicit boolean `true` may open the gate.
  const sloppy = {
    hit: async () => ({ allowed: "yes", retryAfterSeconds: "soon" }),
  } as unknown as RateLimitStore;
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, store: sloppy, now: clock.now });

  const result = await call(limiter, fakeRequest({ ip: "203.0.113.7" }));

  assert.equal(result.passed, false, "truthy is not true");
  assert.equal(result.captured.statusCode, 429);
  assert.match(result.captured.headers["retry-after"] ?? "", /^[1-9][0-9]*$/, "a garbage retry-after falls back to the window");
});

test("a store returning nothing at all is a denial", async () => {
  const clock = testClock();
  const empty = { hit: async () => undefined } as unknown as RateLimitStore;
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, store: empty, now: clock.now });

  assert.equal((await call(limiter, fakeRequest({ ip: "203.0.113.7" }))).passed, false);
});

test("a downstream handler error is NOT relabelled as a rate-limit denial", async () => {
  // Proves next() is called outside the limiter's try/catch. Swallowing a
  // handler's exception into a 429 would hide real bugs behind a plausible
  // status code.
  const clock = testClock();
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, now: clock.now });
  const { res } = fakeResponse();
  const boom = new Error("handler exploded");

  await assert.rejects(
    async () =>
      await (limiter(fakeRequest({ ip: "203.0.113.7" }), res, (() => {
        throw boom;
      }) as NextFunction) as Promise<void>),
    /handler exploded/,
  );
});

test("a limit of zero closes the route entirely", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({
    scope: "closed",
    rule: { limit: 0, windowMs: 60_000 },
    now: clock.now,
  });

  assert.equal((await call(limiter, fakeRequest({ ip: "203.0.113.7" }))).passed, false);
});

test("an invalid rule is rejected at construction, never at request time", () => {
  const cases: RateLimitRule[] = [
    { limit: -1, windowMs: 60_000 },
    { limit: 1.5, windowMs: 60_000 },
    { limit: 5, windowMs: 0 },
    { limit: 5, windowMs: -1 },
    { limit: Number.NaN, windowMs: 60_000 },
  ];
  for (const rule of cases) {
    assert.throws(
      () => createRateLimiter({ scope: "s", rule }),
      RangeError,
      `${JSON.stringify(rule)} must not build`,
    );
  }
  assert.throws(() => createRateLimiter({ scope: "", rule: TIGHT }), RangeError);
  assert.throws(
    () => createRateLimiter({ scope: "s", rule: TIGHT, trustedProxyHops: -1 }),
    RangeError,
  );
  assert.throws(
    () => createRateLimiter({ scope: "s", rule: TIGHT, trustedProxyHops: 1.5 }),
    RangeError,
  );
});

// --- Memory safety ---------------------------------------------------------

test("the in-memory store never exceeds its key bound", async () => {
  // The DoS this bound exists for: an attacker rotating source addresses to
  // insert one map entry per request until the heap is gone.
  const store = new InMemoryRateLimitStore(100);
  for (let i = 0; i < 5_000; i += 1) {
    await store.hit(`key-${i}`, TIGHT, START_MS);
    assert.ok(store.size <= 100, `store grew to ${store.size} at insertion ${i}`);
  }
  assert.ok(store.size > 0, "and it is still actually tracking something");
});

test("the bound holds through the middleware under a rotating-address flood", async () => {
  const clock = testClock();
  const store = new InMemoryRateLimitStore(64);
  const limiter = createRateLimiter({ scope: "redeem", rule: TIGHT, store, now: clock.now });

  for (let i = 0; i < 2_000; i += 1) {
    await call(limiter, fakeRequest({ ip: `198.51.100.${i % 251}.${i}` }));
  }
  assert.ok(store.size <= 64, `store grew to ${store.size}`);
});

test("expired entries are reclaimed rather than accumulating", async () => {
  const store = new InMemoryRateLimitStore(10_000);
  for (let i = 0; i < 50; i += 1) {
    await store.hit(`key-${i}`, TIGHT, START_MS);
  }
  assert.equal(store.size, 50);

  // One insertion after the window closes sweeps the expired front of the map.
  await store.hit("late-arrival", TIGHT, START_MS + TIGHT.windowMs);

  assert.equal(store.size, 1, "50 dead entries must not survive as garbage");
});

test("reclaiming does not disturb a caller whose window is still open", async () => {
  const store = new InMemoryRateLimitStore(10_000);
  const long: RateLimitRule = { limit: 2, windowMs: 600_000 };
  const short: RateLimitRule = { limit: 2, windowMs: 1_000 };

  await store.hit("long-lived", long, START_MS);
  for (let i = 0; i < 40; i += 1) {
    await store.hit(`short-${i}`, short, START_MS);
  }

  const later = START_MS + 2_000;
  await store.hit("trigger", short, later);

  // The long window is still open, so its count must have survived the sweep.
  const second = await store.hit("long-lived", long, later);
  const third = await store.hit("long-lived", long, later);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false, "the surviving entry kept its count");
});

test("a store built with a nonsensical bound is rejected", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => new InMemoryRateLimitStore(bad), RangeError, `maxKeys=${bad}`);
  }
});

// --- Denial telemetry ------------------------------------------------------

test("the denial hook reports the reason and a hashed key, never a raw address", async () => {
  const clock = testClock();
  const denials: RateLimitDenial[] = [];
  const limiter = createRateLimiter({
    scope: "launch.redeem",
    rule: { limit: 1, windowMs: 60_000 },
    now: clock.now,
    onDenied: (denial) => denials.push(denial),
  });
  const req = fakeRequest({ ip: "203.0.113.7", method: "POST", path: "/launch/redeem" });

  await call(limiter, req);
  await call(limiter, req);

  assert.equal(denials.length, 1, "only the denial fires the hook, not the allowed request");
  const denial = denials[0];
  assert.ok(denial !== undefined);
  if (denial === undefined) return;
  assert.equal(denial.reason, "over_limit");
  assert.equal(denial.scope, "launch.redeem");
  assert.equal(denial.method, "POST");
  assert.equal(denial.path, "/launch/redeem");
  assert.match(denial.key ?? "", /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(denial).includes("203.0.113.7"), "raw address must not reach telemetry");
});

test("the denial hook distinguishes the three refusal causes for operators", async () => {
  const clock = testClock();
  const denials: RateLimitDenial[] = [];
  const record = (denial: RateLimitDenial): void => {
    denials.push(denial);
  };

  const overLimit = createRateLimiter({
    scope: "s", rule: { limit: 0, windowMs: 60_000 }, now: clock.now, onDenied: record,
  });
  const broken = createRateLimiter({
    scope: "s",
    rule: TIGHT,
    now: clock.now,
    onDenied: record,
    store: { hit(): Promise<RateLimitDecision> { throw new Error("down"); } },
  });

  await call(overLimit, fakeRequest({ ip: "203.0.113.7" }));
  await call(overLimit, fakeRequest({ ip: undefined }));
  await call(broken, fakeRequest({ ip: "203.0.113.7" }));

  assert.deepEqual(
    denials.map((d) => d.reason),
    ["over_limit", "no_caller_identity", "limiter_error"],
  );
  // The two failure modes carry no key, because there was nothing to key on.
  assert.equal(denials[1]?.key, null);
  assert.equal(denials[2]?.key, null);
});

test("a throwing denial hook does not prevent the 429", async () => {
  const clock = testClock();
  const limiter = createRateLimiter({
    scope: "s",
    rule: { limit: 0, windowMs: 60_000 },
    now: clock.now,
    onDenied: () => {
      throw new Error("metrics pipeline down");
    },
  });

  const result = await call(limiter, fakeRequest({ ip: "203.0.113.7" }));

  assert.equal(result.passed, false);
  assert.equal(result.captured.statusCode, 429);
  assert.deepEqual(result.captured.body, { error: { message: "Too many requests" } });
});
