/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 inbound route tests. Real Express app on an ephemeral port, driven
 * with `fetch` — same pattern as stage2/stage2Route.test.ts.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { createInboundEventRouter } from "./inboundEventRoute.ts";
import { InMemoryInboundEventRepository } from "./inboundEventRepository.ts";
import { InMemoryLifecycleAggregateStore } from "./lifecycleDispatcher.ts";
import { InMemoryNonceStore } from "../service-auth/nonceStore.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";
import { signRequest } from "../service-auth/hmac.ts";

const KEY_ID = "ros-to-is-test";
const SECRET = "a".repeat(64);
const ENABLED = { LIGHTHOUSE_FF_LIFECYCLE_SYNCHRONIZATION: "true" };
const DISABLED = { LIGHTHOUSE_FF_LIFECYCLE_SYNCHRONIZATION: "false" };
const PATH = "/v1/lighthouse/sync/events";

let server: Server;
let baseUrl: string;
let inboundEvents: InMemoryInboundEventRepository;
let linkStore: InMemoryLifecycleAggregateStore;
let audit: InMemoryAuditSink;
let nonces: InMemoryNonceStore;
let clock: Date;
let env: Record<string, string | undefined>;
let invalidated: Array<{ kind: string; id: string }>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

before(async () => {
  const app = express();
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

  inboundEvents = new InMemoryInboundEventRepository();
  linkStore = new InMemoryLifecycleAggregateStore();
  audit = new InMemoryAuditSink();
  nonces = new InMemoryNonceStore();
  clock = new Date("2026-09-02T12:00:00.000Z");
  env = { ...ENABLED };
  invalidated = [];

  app.use(
    "/v1/lighthouse",
    createInboundEventRouter({
      inboundEvents,
      dispatch: {
        stores: { link: linkStore },
        onInvalidate: (kind, id) => { invalidated.push({ kind, id }); },
      },
      auditSink: audit,
      nonces,
      inboundSecrets: { [KEY_ID]: SECRET },
      now: () => clock,
      env,
    }),
  );

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let eventCounter = 0;
function freshEventBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  eventCounter += 1;
  const base = {
    eventId: `evt-${eventCounter}`,
    aggregateKind: "link",
    aggregateId: `link-${eventCounter}`,
    targetState: "active",
    version: 1,
    occurredAt: "2026-09-02T12:00:01.000Z",
  };
  const body = { ...base, ...overrides };
  body.payloadHash = overrides.payloadHash ?? hash(JSON.stringify(body));
  return body;
}

async function postEvent(
  body: unknown,
  overrides: { keyId?: string; secret?: string; nonce?: string; service?: string } = {},
): Promise<Response> {
  const rawBody = JSON.stringify(body);
  const headers = signRequest({
    serviceName: overrides.service ?? "relationship-os",
    keyId: overrides.keyId ?? KEY_ID,
    secret: overrides.secret ?? SECRET,
    method: "POST",
    path: PATH,
    rawBody,
    now: () => Math.floor(clock.getTime() / 1000),
    ...(overrides.nonce ? { nonce: overrides.nonce } : {}),
  });
  return fetch(`${baseUrl}${PATH}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: rawBody,
  });
}

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

test("the route is 503 while the feature flag is off", async () => {
  Object.assign(env, DISABLED);
  try {
    const res = await postEvent(freshEventBody());
    assert.equal(res.status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

test("the flag is checked before signature verification", async () => {
  Object.assign(env, DISABLED);
  try {
    // No signature at all — if the flag were checked after auth this would be 401.
    const res = await fetch(`${baseUrl}${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(freshEventBody()),
    });
    assert.equal(res.status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

// ---------------------------------------------------------------------------
// Service authentication
// ---------------------------------------------------------------------------

test("a correctly signed event is applied", async () => {
  const res = await postEvent(freshEventBody());
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.outcome, "applied");
});

test("an unsigned request is rejected", async () => {
  const res = await fetch(`${baseUrl}${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(freshEventBody()),
  });
  assert.equal(res.status, 401);
});

test("a request signed with the wrong secret is rejected", async () => {
  const res = await postEvent(freshEventBody(), { secret: "b".repeat(64) });
  assert.equal(res.status, 401);
});

test("a request signed by an unknown key id is rejected", async () => {
  const res = await postEvent(freshEventBody(), { keyId: "unknown-key" });
  assert.equal(res.status, 401);
});

test("a request claiming to be a different service is rejected", async () => {
  const res = await postEvent(freshEventBody(), { service: "some-other-service" });
  assert.equal(res.status, 401);
});

test("a replayed nonce is rejected even though the signature is valid", async () => {
  const nonce = "c".repeat(32);
  const body = freshEventBody();
  const first = await postEvent(body, { nonce });
  assert.equal(first.status, 200);
  const replay = await postEvent(body, { nonce });
  assert.equal(replay.status, 401);
});

test("an unexpected field is rejected rather than ignored", async () => {
  const body = freshEventBody({ somethingElse: "nope" });
  const res = await postEvent(body);
  assert.equal(res.status, 400);
});

test("a missing payloadHash is rejected — it is required, not optional", async () => {
  const body = freshEventBody();
  delete (body as Record<string, unknown>).payloadHash;
  const res = await postEvent(body);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Idempotency: duplicate vs conflict (the P0 property)
// ---------------------------------------------------------------------------

test("a reused eventId with an IDENTICAL payload hash is a safe duplicate", async () => {
  const body = freshEventBody();
  const first = await postEvent(body);
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as Record<string, unknown>).outcome, "applied");

  const replay = await postEvent(body);
  assert.equal(replay.status, 200);
  const replayBody = (await replay.json()) as Record<string, unknown>;
  assert.equal(replayBody.outcome, "duplicate");
});

test("a reused eventId with a DIFFERENT payload hash is a conflict, never silently applied", async () => {
  const body = freshEventBody();
  const first = await postEvent(body);
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as Record<string, unknown>).outcome, "applied");

  // Same eventId and aggregate, mutated targetState/version — different bytes,
  // different hash.
  const mutated = {
    ...body,
    targetState: "suspended",
    payloadHash: hash(JSON.stringify({ ...body, targetState: "suspended", mutated: true })),
  };
  const conflictRes = await postEvent(mutated);
  assert.equal(conflictRes.status, 200);
  const conflictBody = (await conflictRes.json()) as Record<string, unknown>;
  assert.equal(conflictBody.outcome, "conflict");

  // The aggregate's state must be unchanged by the conflicting event.
  const state = await linkStore.loadState(body.aggregateId as string);
  assert.equal(state?.state, "active");
});

// ---------------------------------------------------------------------------
// Out-of-order and unknown aggregate kind
// ---------------------------------------------------------------------------

test("an out-of-order (stale version) event is dropped without regressing state", async () => {
  const aggregateId = `link-stale-${++eventCounter}`;
  const activate = freshEventBody({ aggregateId, version: 5 });
  const activateRes = await postEvent(activate);
  assert.equal(((await activateRes.json()) as Record<string, unknown>).outcome, "applied");

  const stale = freshEventBody({ aggregateId, targetState: "suspended", version: 2 });
  const staleRes = await postEvent(stale);
  const staleBody = (await staleRes.json()) as Record<string, unknown>;
  assert.equal(staleBody.outcome, "stale");

  const state = await linkStore.loadState(aggregateId);
  assert.equal(state?.state, "active");
  assert.equal(state?.version, 5);
});

test("an unknown aggregate_kind fails closed", async () => {
  const body = freshEventBody({ aggregateKind: "not_a_real_kind" });
  const res = await postEvent(body);
  assert.equal(res.status, 400);
});

test("a revoking transition fires the invalidation hook", async () => {
  const aggregateId = `link-revoke-${++eventCounter}`;
  await postEvent(freshEventBody({ aggregateId, targetState: "active", version: 1 }));
  const before = invalidated.length;
  await postEvent(freshEventBody({ aggregateId, targetState: "revoked", version: 2 }));
  assert.ok(invalidated.length > before, "revoking transition did not invalidate");
});
