/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 4 route tests.
 *
 * Real Express app on an ephemeral port, driven with `fetch` — same rationale
 * as stage2Route.test.ts: the properties under test (status codes, flag
 * gating order, response shape) live in the HTTP layer, not in a hand-built
 * fake `req`.
 *
 * Hermetic: no database, no network beyond loopback, injected clock.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createShareGrantRouter } from "./shareGrantRoute.ts";
import { InMemoryShareGrantRepository } from "./shareGrantRepository.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";

const ENABLED = { LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING: "true" };
const DISABLED = { LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING: "false" };

const CLIENT = "actor-client-1";
const OTHER_CLIENT = "actor-client-2";
const ACTIVE_LINK = "link-active";
const INACTIVE_LINK = "link-inactive";

let server: Server;
let baseUrl: string;
let grants: InMemoryShareGrantRepository;
let audit: InMemoryAuditSink;
let clock: Date;
let env: Record<string, string | undefined>;
/** Set to null to simulate an unauthenticated caller. */
let currentActor: string | null;
let grantCounter: number;
/** Maps (linkId, clientUserRef) -> active, so the route's isLinkActive dependency is fully controllable. */
let activeLinks: Set<string>;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  grants = new InMemoryShareGrantRepository();
  audit = new InMemoryAuditSink();
  clock = new Date("2026-09-02T12:00:00.000Z");
  env = { ...ENABLED };
  currentActor = CLIENT;
  grantCounter = 0;
  activeLinks = new Set([`${ACTIVE_LINK}::${CLIENT}`]);

  // Stands in for requireSession, which runs ahead of this router in bootstrap.
  const fakeSession = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ): void => {
    if (currentActor) req.lighthouseSession = { actorRef: currentActor } as never;
    next();
  };

  app.use(
    "/v1/lighthouse",
    fakeSession,
    createShareGrantRouter({
      grants,
      auditSink: audit,
      isLinkActive: async (crossProductLinkId, clientUserRef) =>
        activeLinks.has(`${crossProductLinkId}::${clientUserRef}`),
      now: () => clock,
      newShareGrantId: () => `grant-${++grantCounter}`,
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

let relCounter = 0;
function freshCreateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  relCounter += 1;
  return {
    crossProductLinkId: ACTIVE_LINK,
    clientUserRef: CLIENT,
    destinationRelationshipRef: `rel-${relCounter}`,
    recipientContext: "professional_assisted",
    selectedAnalysisIds: ["analysis-1"],
    selectedFields: ["grade", "primaryRisk"],
    purpose: "mortgage_review",
    expiresAt: null,
    noticeVersion: "share-notice-v1",
    consentAffirmed: true,
    ...overrides,
  };
}

async function createShare(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listShares(): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/shares`);
}

async function revoke(shareGrantId: string, expectedVersion: number): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/shares/${shareGrantId}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion }),
  });
}

async function createAndParse(overrides: Record<string, unknown> = {}) {
  const res = await createShare(freshCreateBody(overrides));
  const body = (await res.json()) as Record<string, unknown>;
  return { res, body };
}

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

test("every route is 503 while the feature flag is off", async () => {
  Object.assign(env, DISABLED);
  try {
    assert.equal((await createShare(freshCreateBody())).status, 503);
    assert.equal((await listShares()).status, 503);
    assert.equal((await revoke("whatever", 1)).status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

test("the flag is checked before schema validation and before any repository work", async () => {
  Object.assign(env, DISABLED);
  try {
    // Malformed body that would fail schema validation. A 400 would prove
    // validation ran despite the flag being off.
    const res = await createShare({ nonsense: true });
    assert.equal(res.status, 503);

    const countBefore = (audit.events ?? []).length;
    await createShare(freshCreateBody());
    assert.equal(
      (audit.events ?? []).length,
      countBefore,
      "a disabled route still wrote an audit event",
    );
  } finally {
    Object.assign(env, ENABLED);
  }
});

// ---------------------------------------------------------------------------
// Session requirement
// ---------------------------------------------------------------------------

test("every route requires an authenticated session", async () => {
  const previous = currentActor;
  currentActor = null;
  try {
    assert.equal((await createShare(freshCreateBody())).status, 401);
    assert.equal((await listShares()).status, 401);
    assert.equal((await revoke("whatever", 1)).status, 401);
  } finally {
    currentActor = previous;
  }
});

// ---------------------------------------------------------------------------
// Create — success and schema validation
// ---------------------------------------------------------------------------

test("a valid share grant is created", async () => {
  const { res, body } = await createAndParse();
  assert.equal(res.status, 201);
  assert.equal(body.state, "created");
  assert.ok(typeof body.shareGrantId === "string");
  assert.equal(body.version, 1);
});

test("an unexpected field is rejected rather than ignored", async () => {
  const res = await createShare({ ...freshCreateBody(), extra: "nope" });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Create — identity: the caller can never assert a different client
// ---------------------------------------------------------------------------

test("a body-supplied clientUserRef different from the session is refused", async () => {
  const res = await createShare(freshCreateBody({ clientUserRef: OTHER_CLIENT }));
  assert.equal(res.status, 403);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.state, "denied");
});

// ---------------------------------------------------------------------------
// Create — domain denials reachable through the HTTP layer
// ---------------------------------------------------------------------------

test("sharing requires an active link", async () => {
  const res = await createShare(freshCreateBody({ crossProductLinkId: INACTIVE_LINK }));
  assert.equal(res.status, 403);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.state, "denied");
  assert.equal(body.reason, undefined, "authorization denials must be opaque");
});

test("no analyses selected is a 400 with the reason", async () => {
  const { res, body } = await createAndParse({ selectedAnalysisIds: [] });
  assert.equal(res.status, 400);
  assert.equal(body.reason, "NO_ANALYSES_SELECTED");
});

test("too many analyses is a 400 with the reason", async () => {
  const many = Array.from({ length: 51 }, (_, i) => `a-${i}`);
  const { res, body } = await createAndParse({ selectedAnalysisIds: many });
  assert.equal(res.status, 400);
  assert.equal(body.reason, "TOO_MANY_ANALYSES");
});

test("no fields selected is a 400 with the reason", async () => {
  const { res, body } = await createAndParse({ selectedFields: [] });
  assert.equal(res.status, 400);
  assert.equal(body.reason, "NO_FIELDS_SELECTED");
});

test("an unknown field is a 400 with the reason", async () => {
  const { res, body } = await createAndParse({ selectedFields: ["grade", "rawWorksheet"] });
  assert.equal(res.status, 400);
  assert.equal(body.reason, "UNKNOWN_FIELD");
});

test("a blank purpose is a 400 with the reason", async () => {
  const { res, body } = await createAndParse({ purpose: "   " });
  assert.equal(res.status, 400);
  assert.equal(body.reason, "PURPOSE_REQUIRED");
});

test("unaffirmed consent is a 400 with the reason", async () => {
  const { res, body } = await createAndParse({ consentAffirmed: false });
  assert.equal(res.status, 400);
  assert.equal(body.reason, "CONSENT_NOT_AFFIRMED");
});

test("an expiry in the past is a 400 with the reason", async () => {
  const { res, body } = await createAndParse({ expiresAt: "2026-08-01T00:00:00.000Z" });
  assert.equal(res.status, 400);
  assert.equal(body.reason, "EXPIRY_IN_PAST");
});

// ---------------------------------------------------------------------------
// GET /shares — scoped to the caller only
// ---------------------------------------------------------------------------

test("shares list returns only the caller's own grants", async () => {
  await createAndParse();

  const mine = await listShares();
  const mineBody = (await mine.json()) as { grants: unknown[] };
  assert.ok(mineBody.grants.length >= 1);

  const previous = currentActor;
  currentActor = OTHER_CLIENT;
  try {
    const theirs = await listShares();
    const theirsBody = (await theirs.json()) as { grants: unknown[] };
    assert.deepEqual(theirsBody.grants, [], "another actor saw grants that are not theirs");
  } finally {
    currentActor = previous;
  }
});

// ---------------------------------------------------------------------------
// Revoke — ownership, compare-and-set, double-revoke
// ---------------------------------------------------------------------------

test("the owning client can revoke their own grant", async () => {
  const { body } = await createAndParse();
  const res = await revoke(body.shareGrantId as string, body.version as number);
  assert.equal(res.status, 200);
  const revoked = (await res.json()) as Record<string, unknown>;
  assert.equal(revoked.state, "revoked");
});

test("another actor cannot revoke somebody else's grant", async () => {
  const { body } = await createAndParse();
  const previous = currentActor;
  currentActor = OTHER_CLIENT;
  try {
    assert.equal((await revoke(body.shareGrantId as string, body.version as number)).status, 403);
  } finally {
    currentActor = previous;
  }
  const still = await grants.findById(body.shareGrantId as string);
  assert.equal(still?.lifecycle.state, "active");
});

test("a stale version cannot revoke", async () => {
  const { body } = await createAndParse();
  assert.equal(
    (await revoke(body.shareGrantId as string, (body.version as number) + 99)).status,
    403,
  );
  assert.equal((await revoke(body.shareGrantId as string, body.version as number)).status, 200);
});

test("revoking twice fails the second time", async () => {
  const { body } = await createAndParse();
  assert.equal((await revoke(body.shareGrantId as string, body.version as number)).status, 200);
  assert.equal((await revoke(body.shareGrantId as string, body.version as number)).status, 403);
});

test("revoke denials return an identical opaque body — no enumeration oracle", async () => {
  const { body } = await createAndParse();
  await revoke(body.shareGrantId as string, body.version as number); // consume it

  const bodies = await Promise.all([
    revoke(body.shareGrantId as string, body.version as number).then((r) => r.text()), // already revoked
    revoke("grant-does-not-exist", 1).then((r) => r.text()), // not found
    revoke(body.shareGrantId as string, 999).then((r) => r.text()), // stale version
  ]);
  assert.equal(new Set(bodies).size, 1, `denial bodies differ: ${JSON.stringify(bodies)}`);
});
