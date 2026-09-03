/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 5 route tests. Same structure as stage2/stage2Route.test.ts: a real
 * Express app on an ephemeral port, driven with `fetch`, HMAC-signed like the
 * Stage 2 invitation-creation route. Hermetic — no database, injected clock.
 *
 * The two tests that matter most here pin the narrowest privacy boundary in
 * the whole integration:
 *   - without disclosure consent, `workspaceAvailability` is "unknown", never
 *     "unavailable" (which would assert a fact nobody consented to reveal).
 *   - the status label is "InvestScape account status not shared", never
 *     anything implying "no subscription" — silence must not leak payment
 *     state.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createProjectionRouter, type ConnectionProjectionSource } from "./projectionRoute.ts";
import { InMemoryLinkRepository } from "../stage2/linkRepository.ts";
import { InMemoryWorkspaceDisclosureRepository } from "../stage3/workspaceDisclosureRepository.ts";
import { InMemoryNonceStore } from "../service-auth/nonceStore.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";
import { signRequest } from "../service-auth/hmac.ts";
import { generateChallenge, hashChallenge } from "../domain/crossProductLink.ts";
import { STATUS_NOT_SHARED } from "../domain/connectionProjection.ts";

const KEY_ID = "ros-to-is-test";
const SECRET = "a".repeat(64);
const ENABLED = { LIGHTHOUSE_FF_PROFESSIONAL_CONNECTIVITY_PROJECTION: "true" };
const DISABLED = { LIGHTHOUSE_FF_PROFESSIONAL_CONNECTIVITY_PROJECTION: "false" };

let server: Server;
let baseUrl: string;
let links: InMemoryLinkRepository;
let disclosures: InMemoryWorkspaceDisclosureRepository;
let audit: InMemoryAuditSink;
let nonces: InMemoryNonceStore;
let clock: Date;
let env: Record<string, string | undefined>;
let workspaceAvailable: boolean;
let sharedResultCount: number;

const PATH = "/v1/lighthouse/connection-projection";

before(async () => {
  const app = express();
  app.use(
    express.json({
      limit: "100kb",
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );

  links = new InMemoryLinkRepository();
  disclosures = new InMemoryWorkspaceDisclosureRepository();
  audit = new InMemoryAuditSink();
  nonces = new InMemoryNonceStore();
  clock = new Date("2026-09-02T12:00:00.000Z");
  env = { ...ENABLED };
  workspaceAvailable = true;
  sharedResultCount = 0;

  const source: ConnectionProjectionSource = {
    isWorkspaceAvailable: async () => workspaceAvailable,
    countActiveSharedResults: async () => sharedResultCount,
  };

  app.use(
    "/v1/lighthouse",
    createProjectionRouter({
      links,
      disclosures,
      source,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let personCounter = 0;

async function createActiveLink(
  actorRef: string,
  relationshipRef: string,
): Promise<string> {
  personCounter += 1;
  const invitationId = `inv-${personCounter}`;
  const challenge = generateChallenge();
  await links.createInvitation({
    invitationId,
    challengeHash: hashChallenge(challenge),
    relationshipOsPersonRef: `ros-person-${personCounter}`,
    relationshipRef,
    expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
    noticeVersion: "notice-v1",
    correlationId: `corr-${personCounter}`,
    consumedAt: null,
  });
  const outcome = await links.accept({
    invitationId,
    presentedChallenge: challenge,
    investscapeActorRef: actorRef,
    correlationId: `corr-${personCounter}`,
    now: clock,
    isEnabled: true,
  });
  if (!outcome.ok) throw new Error(`test setup failed: ${JSON.stringify(outcome)}`);
  return outcome.link.crossProductLinkId;
}

async function requestProjection(
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
// Flag
// ---------------------------------------------------------------------------

test("the route is 503 while the feature flag is off", async () => {
  Object.assign(env, DISABLED);
  try {
    const res = await requestProjection({
      relationshipRef: "rel-1", crossProductLinkId: "link-1", clientActorRef: "actor-1",
    });
    assert.equal(res.status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

// ---------------------------------------------------------------------------
// Service authentication
// ---------------------------------------------------------------------------

test("an unsigned request is rejected", async () => {
  const res = await fetch(`${baseUrl}${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      relationshipRef: "rel-1", crossProductLinkId: "link-1", clientActorRef: "actor-1",
    }),
  });
  assert.equal(res.status, 401);
});

test("a request signed with the wrong secret is rejected", async () => {
  const res = await requestProjection(
    { relationshipRef: "rel-1", crossProductLinkId: "link-1", clientActorRef: "actor-1" },
    { secret: "b".repeat(64) },
  );
  assert.equal(res.status, 401);
});

test("a replayed nonce is rejected", async () => {
  const nonce = "c".repeat(32);
  const body = { relationshipRef: "rel-replay", crossProductLinkId: "link-x", clientActorRef: "actor-x" };
  const first = await requestProjection(body, { nonce });
  assert.equal(first.status, 200);
  const replay = await requestProjection(body, { nonce });
  assert.equal(replay.status, 401);
});

test("an unexpected field is rejected rather than ignored", async () => {
  const res = await requestProjection({
    relationshipRef: "rel-1", crossProductLinkId: "link-1", clientActorRef: "actor-1",
    email: "someone@example.com",
  });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// The privacy properties
// ---------------------------------------------------------------------------

test("without disclosure consent, workspaceAvailability is 'unknown' — never 'unavailable'", async () => {
  const linkId = await createActiveLink("actor-nc-1", "rel-nc-1");
  // No consent set at all.
  const res = await requestProjection({
    relationshipRef: "rel-nc-1", crossProductLinkId: linkId, clientActorRef: "actor-nc-1",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { workspaceAvailability: string; statusLabel: string };
  assert.equal(body.workspaceAvailability, "unknown");
  assert.notEqual(body.workspaceAvailability, "unavailable");
});

test("without disclosure consent, statusLabel is 'not shared' — never implies 'no subscription'", async () => {
  const linkId = await createActiveLink("actor-nc-2", "rel-nc-2");
  const res = await requestProjection({
    relationshipRef: "rel-nc-2", crossProductLinkId: linkId, clientActorRef: "actor-nc-2",
  });
  const body = (await res.json()) as { statusLabel: string };
  assert.equal(body.statusLabel, STATUS_NOT_SHARED);
  assert.ok(!/no subscription|unsubscribed|not paid|unpaid/i.test(body.statusLabel));
});

test("with consent, workspaceAvailability reflects the source's live value", async () => {
  const linkId = await createActiveLink("actor-c-1", "rel-c-1");
  await disclosures.setConsent("actor-c-1", "rel-c-1", linkId, true, clock);

  workspaceAvailable = true;
  const available = await requestProjection({
    relationshipRef: "rel-c-1", crossProductLinkId: linkId, clientActorRef: "actor-c-1",
  });
  const availableBody = (await available.json()) as { workspaceAvailability: string };
  assert.equal(availableBody.workspaceAvailability, "available");

  workspaceAvailable = false;
  const unavailable = await requestProjection({
    relationshipRef: "rel-c-1", crossProductLinkId: linkId, clientActorRef: "actor-c-1",
  });
  const unavailableBody = (await unavailable.json()) as { workspaceAvailability: string };
  assert.equal(unavailableBody.workspaceAvailability, "unavailable");
});

test("no plan, price, payment, or usage fields ever appear in the response", async () => {
  const linkId = await createActiveLink("actor-c-2", "rel-c-2");
  await disclosures.setConsent("actor-c-2", "rel-c-2", linkId, true, clock);
  const res = await requestProjection({
    relationshipRef: "rel-c-2", crossProductLinkId: linkId, clientActorRef: "actor-c-2",
  });
  const serialised = (await res.text()).toLowerCase();
  for (const forbidden of ["plan", "price", "payment", "renewal", "usage", "portfolio"]) {
    assert.ok(!serialised.includes(forbidden), `${forbidden} leaked into the projection response`);
  }
});

test("a link that does not match the asserted client/relationship yields 'not connected'", async () => {
  const linkId = await createActiveLink("actor-real", "rel-real");
  const res = await requestProjection({
    relationshipRef: "rel-real", crossProductLinkId: linkId, clientActorRef: "actor-imposter",
  });
  const body = (await res.json()) as { connectionState: string; sharedResultCount: number };
  assert.equal(body.connectionState, "not_connected");
  assert.equal(body.sharedResultCount, 0);
});

test("there is no route to enumerate a client's analyses", async () => {
  // The domain guard exists; this test documents that this router never wires
  // a listing endpoint to it. No HTTP call is possible for "list analyses".
  const res = await fetch(`${baseUrl}/v1/lighthouse/analyses`);
  assert.equal(res.status, 404);
});
