/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 inbound route tests. Real Express app on an ephemeral port, driven
 * with `fetch` — same pattern as stage2/stage2Route.test.ts. The rules
 * themselves are covered in eventIntegrity.test.ts; this file covers the HTTP
 * contract around them: flag, service auth, rule 1 (schema + digest), the
 * `lighthouse.event-ack.v1` responses and status codes, and the after-commit
 * hooks.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createInboundEventRouter } from "./inboundEventRoute.ts";
import { InMemoryEventIntegrityStore } from "./eventIntegrityStore.ts";
import { computeEventDigest, type EventEnvelope } from "./eventDigest.ts";
import type { QuarantineAlert } from "./eventIntegrity.ts";
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
let store: InMemoryEventIntegrityStore;
let audit: InMemoryAuditSink;
let clock: Date;
let env: Record<string, string | undefined>;
let invalidated: Array<{ kind: string; id: string }>;
let alerts: QuarantineAlert[];
let alertShouldThrow = false;
let quarantineCounter = 0;

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

  store = new InMemoryEventIntegrityStore({ aggregateKinds: ["link", "share_grant"] });
  audit = new InMemoryAuditSink();
  clock = new Date("2026-09-28T12:00:00.000Z");
  env = { ...ENABLED };
  invalidated = [];
  alerts = [];

  app.use(
    "/v1/lighthouse",
    createInboundEventRouter({
      eventIntegrity: store,
      auditSink: audit,
      nonces: new InMemoryNonceStore(),
      inboundSecrets: { [KEY_ID]: SECRET },
      now: () => clock,
      newQuarantineId: () => `q-${++quarantineCounter}`,
      onQuarantineAlert: (alert) => {
        alerts.push(alert);
        if (alertShouldThrow) throw new Error("alert sink down");
      },
      onInvalidate: (kind, id) => { invalidated.push({ kind, id }); },
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

let counter = 0;

/** A link at version 1, `active`, that InvestScape already holds locally. */
function seededLink(): string {
  const id = `link-${++counter}`;
  store.seedAggregate("link", id, { state: "active", version: 1, occurredAt: "2026-09-28T11:00:00.000Z" });
  return id;
}

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  counter += 1;
  return {
    eventId: `evt-${counter}`,
    schemaVersion: "investscape.link.changed.v1",
    aggregateKind: "link",
    aggregateId: overrides.aggregateId ?? seededLink(),
    targetState: "suspended",
    version: 2,
    changeSeq: String(1000 + counter),
    occurredAt: "2026-09-28T12:00:01.000Z",
    payload: { reason: "test" },
    ...overrides,
  };
}

function signed(env: EventEnvelope): Record<string, unknown> {
  return { ...env, eventDigest: computeEventDigest(env) };
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

async function send(body: unknown): Promise<{ status: number; ack: Record<string, unknown> }> {
  const res = await postEvent(body);
  return { status: res.status, ack: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// The flag and service authentication
// ---------------------------------------------------------------------------

test("the route is 503 while the feature flag is off", async () => {
  Object.assign(env, DISABLED);
  try {
    const res = await postEvent(signed(envelope()));
    assert.equal(res.status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

test("the flag is checked before signature verification", async () => {
  Object.assign(env, DISABLED);
  try {
    const res = await fetch(`${baseUrl}${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed(envelope())),
    });
    assert.equal(res.status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

test("an unsigned request is rejected", async () => {
  const res = await fetch(`${baseUrl}${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signed(envelope())),
  });
  assert.equal(res.status, 401);
});

test("wrong secret, unknown key id and wrong service are all rejected", async () => {
  assert.equal((await postEvent(signed(envelope()), { secret: "b".repeat(64) })).status, 401);
  assert.equal((await postEvent(signed(envelope()), { keyId: "unknown-key" })).status, 401);
  assert.equal((await postEvent(signed(envelope()), { service: "some-other-service" })).status, 401);
});

test("a replayed nonce is rejected even though the signature is valid", async () => {
  const nonce = "c".repeat(32);
  const body = signed(envelope());
  assert.equal((await postEvent(body, { nonce })).status, 200);
  assert.equal((await postEvent(body, { nonce })).status, 401);
});

// ---------------------------------------------------------------------------
// Rule 1 — malformed events are rejected and NOT ledgered
// ---------------------------------------------------------------------------

test("an unexpected field is rejected rather than ignored", async () => {
  const res = await postEvent({ ...signed(envelope()), somethingElse: "nope" });
  assert.equal(res.status, 400);
});

test("the legacy payloadHash field is no longer accepted", async () => {
  const env = envelope();
  const { eventDigest: _drop, ...rest } = signed(env);
  const res = await postEvent({ ...rest, payloadHash: "0".repeat(64) });
  assert.equal(res.status, 400);
});

test("eventDigest, changeSeq and payload are all required", async () => {
  for (const field of ["eventDigest", "changeSeq", "payload", "schemaVersion"]) {
    const body = signed(envelope());
    delete body[field];
    assert.equal((await postEvent(body)).status, 400, `${field} should be required`);
  }
});

test("version 0 and a non-decimal changeSeq are malformed", async () => {
  assert.equal((await postEvent(signed(envelope({ version: 0 })))).status, 400);
  assert.equal((await postEvent(signed(envelope({ changeSeq: "01" })))).status, 400);
  assert.equal((await postEvent(signed(envelope({ changeSeq: "-5" })))).status, 400);
});

test("a sent digest that differs from the recomputed one is 400 EVENT_DIGEST_MISMATCH and records nothing", async () => {
  const env = envelope();
  const before = store.counts;
  const res = await postEvent({ ...env, eventDigest: computeEventDigest({ ...env, targetState: "revoked" }) });
  assert.equal(res.status, 400);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.reason, "EVENT_DIGEST_MISMATCH");
  assert.deepEqual(store.counts, before);
  assert.equal(store.ledgerEntry(env.eventId), null);
});

test("tampering with the payload after digesting is caught by the digest", async () => {
  const body = signed(envelope());
  (body.payload as Record<string, unknown>).reason = "tampered";
  const res = await postEvent(body);
  assert.equal(res.status, 400);
});

test("an unknown aggregate kind fails closed", async () => {
  const res = await postEvent(signed(envelope({ aggregateKind: "not_a_real_kind" })));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Acknowledgements
// ---------------------------------------------------------------------------

test("an applied event returns a full lighthouse.event-ack.v1", async () => {
  const env = envelope();
  const { status, ack } = await send(signed(env));
  assert.equal(status, 200);
  assert.deepEqual(ack, {
    schemaVersion: "lighthouse.event-ack.v1",
    eventId: env.eventId,
    aggregateKind: "link",
    aggregateId: env.aggregateId,
    version: 2,
    outcome: "applied",
    storedVersion: 2,
    receivedAt: clock.toISOString(),
  });
});

test("a retry of the same bytes is 200 duplicate with originalOutcome", async () => {
  const body = signed(envelope());
  await send(body);
  const { status, ack } = await send(body);
  assert.equal(status, 200);
  assert.equal(ack.outcome, "duplicate");
  assert.equal(ack.originalOutcome, "applied");
});

test("a reused eventId with different bytes is 409 conflict with a quarantine, never 200", async () => {
  const env = envelope();
  await send(signed(env));
  const { status, ack } = await send(signed({ ...env, targetState: "revoked" }));
  assert.equal(status, 409);
  assert.equal(ack.outcome, "conflict");
  assert.equal(ack.conflictKind, "EVENT_ID_DIGEST_MISMATCH");
  assert.match(String(ack.quarantineId), /^q-/);
  assert.equal(store.aggregate("link", env.aggregateId)?.state, "suspended");
});

test("a forbidden transition is 422 rejected_transition with a quarantine", async () => {
  const aggregateId = `link-${++counter}`;
  store.seedAggregate("link", aggregateId, { state: "revoked", version: 3, occurredAt: "2026-09-28T11:00:00.000Z" });
  const { status, ack } = await send(signed(envelope({ aggregateId, targetState: "active", version: 4 })));
  assert.equal(status, 422);
  assert.equal(ack.outcome, "rejected_transition");
  assert.ok(ack.quarantineId);
  assert.equal(store.aggregate("link", aggregateId)?.state, "revoked");
});

test("an event for a blocked aggregate is 409 blocked", async () => {
  const aggregateId = seededLink();
  await send(signed(envelope({ aggregateId, targetState: "revoked", version: 2 })));
  const first = envelope({ aggregateId, targetState: "suspended", version: 2 });
  const conflict = await send(signed(first)); // same version, different content
  assert.equal(conflict.status, 409);
  const { status, ack } = await send(signed(envelope({ aggregateId, targetState: "revoked", version: 3 })));
  assert.equal(status, 409);
  assert.equal(ack.outcome, "blocked");
  assert.equal(ack.quarantineId, conflict.ack.quarantineId);
});

test("a stale event is 200 stale", async () => {
  const aggregateId = seededLink();
  const { status, ack } = await send(signed(envelope({ aggregateId, targetState: "revoked", version: 1 })));
  assert.equal(status, 200);
  assert.equal(ack.outcome, "stale");
  assert.equal(ack.storedVersion, 1);
});

test("an aggregate InvestScape never created is 409 AGGREGATE_NOT_FOUND and records nothing", async () => {
  const env = envelope({ aggregateId: "link-never-created" });
  const res = await postEvent(signed(env));
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as Record<string, unknown>).reason, "AGGREGATE_NOT_FOUND");
  assert.equal(store.ledgerEntry(env.eventId), null);
});

test("an aggregate kind with no wired store is 503 and records nothing", async () => {
  const env = envelope({ aggregateKind: "mandate", aggregateId: "m-1", targetState: "active" });
  const res = await postEvent(signed(env));
  assert.equal(res.status, 503);
  assert.equal(store.ledgerEntry(env.eventId), null);
});

// ---------------------------------------------------------------------------
// After-commit hooks
// ---------------------------------------------------------------------------

test("a quarantine fires the alert hook once, with digests but no payload", async () => {
  const before = alerts.length;
  const env = envelope();
  await send(signed(env));
  await send(signed({ ...env, payload: { reason: "other" } }));
  assert.equal(alerts.length, before + 1);
  const alert = alerts[alerts.length - 1]!;
  assert.equal(alert.kind, "EVENT_ID_DIGEST_MISMATCH");
  assert.equal(alert.opened, true);
  assert.equal(alert.eventId, env.eventId);
  assert.ok(!JSON.stringify(alert).includes("other"), "the alert must not carry the body");
  assert.ok(audit.events.some((e) => e.eventType === "stage6.quarantine.opened"));
});

test("a failing alert hook does not change the committed answer", async () => {
  alertShouldThrow = true;
  try {
    const env = envelope();
    await send(signed(env));
    const { status, ack } = await send(signed({ ...env, targetState: "revoked" }));
    assert.equal(status, 409);
    assert.equal(ack.outcome, "conflict");
  } finally {
    alertShouldThrow = false;
  }
});

test("a blocked event does not raise a second alert", async () => {
  const aggregateId = seededLink();
  await send(signed(envelope({ aggregateId, targetState: "revoked", version: 2 })));
  await send(signed(envelope({ aggregateId, targetState: "suspended", version: 2 })));
  const before = alerts.length;
  await send(signed(envelope({ aggregateId, targetState: "revoked", version: 3 })));
  assert.equal(alerts.length, before);
});

test("a revoking transition fires the invalidation hook; a replay of it does not", async () => {
  const body = signed(envelope({ targetState: "revoked" }));
  const before = invalidated.length;
  await send(body);
  assert.equal(invalidated.length, before + 1);
  await send(body);
  assert.equal(invalidated.length, before + 1);
});
