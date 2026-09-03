/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 8 route tests.
 *
 * These run against a REAL Express app on an ephemeral port, driven with
 * `fetch` — same rationale as stage2Route.test.ts: the properties under test
 * (middleware ordering, status codes, session wiring) live in the HTTP layer
 * itself.
 *
 * Hermetic: no database, no network beyond loopback, injected clock.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createDelegationRouter, type DelegationRouteDependencies } from "./delegationRoute.ts";
import { InMemoryDelegationMandateRepository } from "./delegationRepository.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";

const ENABLED = { LIGHTHOUSE_FF_DELEGATED_PORTFOLIO_MANAGEMENT: "true" };
const DISABLED = { LIGHTHOUSE_FF_DELEGATED_PORTFOLIO_MANAGEMENT: "false" };

const PRO = "actor-professional-1";
const CLIENT = "actor-client-1";

let server: Server;
let baseUrl: string;
let mandates: InMemoryDelegationMandateRepository;
let audit: InMemoryAuditSink;
let clock: Date;
let env: Record<string, string | undefined>;
/** Set to null to simulate an unauthenticated caller. */
let currentActor: string | null;
let idCounter: number;
let repActive: boolean;
let proEligible: boolean;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  mandates = new InMemoryDelegationMandateRepository();
  audit = new InMemoryAuditSink();
  clock = new Date("2026-09-02T12:00:00.000Z");
  env = { ...ENABLED };
  currentActor = PRO;
  idCounter = 0;
  repActive = true;
  proEligible = true;

  // Stands in for requireSession, which runs ahead of this router in bootstrap.
  const fakeSession = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ): void => {
    if (currentActor) req.lighthouseSession = { actorRef: currentActor } as never;
    next();
  };

  const deps: DelegationRouteDependencies = {
    mandates,
    auditSink: audit,
    checkRepresentationActive: async () => repActive,
    checkProfessionalEligible: async () => proEligible,
    now: () => clock,
    newRequestId: () => `req-${++idCounter}`,
    newMandateId: () => `mandate-${idCounter}`,
    env,
  };

  app.use("/v1/lighthouse", fakeSession, createDelegationRouter(deps));

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

function freshRequestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientUserRef: CLIENT,
    relationshipRef: "rel-1",
    representationRef: "repr-1",
    requestedScopes: ["delegated.portfolio.view"],
    purpose: "portfolio_setup",
    noticeVersion: "mandate-notice-v1",
    ...overrides,
  };
}

async function createRequest(
  body: Record<string, unknown> = freshRequestBody(),
): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/delegation/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function accept(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/delegation/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listMandates(): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/delegation/mandates`);
}

async function revoke(mandateId: string, expectedVersion: number): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/delegation/${mandateId}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion }),
  });
}

/** Creates a request as the professional, then accepts it as the client. */
async function createAndAccept(): Promise<{
  mandateId: string;
  version: number;
}> {
  const previousActor = currentActor;
  currentActor = PRO;
  const created = await createRequest();
  const { requestId, challenge } = (await created.json()) as {
    requestId: string;
    challenge: string;
  };

  currentActor = CLIENT;
  const res = await accept({ requestId, challenge, portfolioRef: "portfolio-1" });
  const body = (await res.json()) as { mandateId: string; version: number };
  currentActor = previousActor;
  return { mandateId: body.mandateId, version: body.version };
}

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

test("every route is 503 while the feature flag is off", async () => {
  Object.assign(env, DISABLED);
  try {
    assert.equal((await createRequest()).status, 503);
    assert.equal(
      (await accept({ requestId: "x", challenge: "y", portfolioRef: "p" })).status,
      503,
    );
    assert.equal((await listMandates()).status, 503);
    assert.equal((await revoke("mandate-x", 1)).status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

test("the flag is checked before schema validation and before any repository work", async () => {
  Object.assign(env, DISABLED);
  try {
    const res = await fetch(`${baseUrl}/v1/lighthouse/delegation/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonsense: true }),
    });
    assert.equal(res.status, 503);

    const countBefore = (audit.events ?? []).length;
    await createRequest();
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
// Session required
// ---------------------------------------------------------------------------

test("every route requires an authenticated session", async () => {
  const previous = currentActor;
  currentActor = null;
  try {
    assert.equal((await createRequest()).status, 401);
    assert.equal(
      (await accept({ requestId: "x", challenge: "y", portfolioRef: "p" })).status,
      401,
    );
    assert.equal((await listMandates()).status, 401);
    assert.equal((await revoke("mandate-x", 1)).status, 401);
  } finally {
    currentActor = previous;
  }
});

// ---------------------------------------------------------------------------
// Request creation
// ---------------------------------------------------------------------------

test("representation-active and professional-eligible default to false — fail closed", async () => {
  const previousRep = repActive;
  const previousElig = proEligible;
  repActive = false;
  proEligible = false;
  try {
    currentActor = PRO;
    const res = await createRequest();
    assert.equal(res.status, 403);
  } finally {
    repActive = previousRep;
    proEligible = previousElig;
  }
});

test("a professional can create a request once representation and eligibility are injected true", async () => {
  currentActor = PRO;
  const res = await createRequest();
  assert.equal(res.status, 201);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.state, "created");
  assert.ok(typeof body.challenge === "string" && (body.challenge as string).length > 0);
});

test("representation not active is refused even with eligibility true", async () => {
  const previous = repActive;
  repActive = false;
  try {
    currentActor = PRO;
    assert.equal((await createRequest()).status, 403);
  } finally {
    repActive = previous;
  }
});

test("an ineligible professional is refused even with representation active", async () => {
  const previous = proEligible;
  proEligible = false;
  try {
    currentActor = PRO;
    assert.equal((await createRequest()).status, 403);
  } finally {
    proEligible = previous;
  }
});

test("a professional cannot request delegation naming themselves as the client", async () => {
  currentActor = PRO;
  const res = await createRequest(freshRequestBody({ clientUserRef: PRO }));
  assert.equal(res.status, 403);
});

test("the professionalUserRef always comes from the session, never the body", async () => {
  // Nothing in the schema even accepts a professionalUserRef field, so
  // supplying one is a strict-schema violation — proving the body cannot
  // influence identity at all.
  currentActor = PRO;
  const res = await createRequest({
    ...freshRequestBody(),
    professionalUserRef: "someone-else",
  });
  assert.equal(res.status, 400);
});

test("an unknown scope is rejected", async () => {
  currentActor = PRO;
  const res = await fetch(`${baseUrl}/v1/lighthouse/delegation/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(freshRequestBody({ requestedScopes: ["delegated.invented"] })),
  });
  assert.equal(res.status, 400);
});

test("a prohibited scope is rejected", async () => {
  currentActor = PRO;
  const res = await fetch(`${baseUrl}/v1/lighthouse/delegation/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(freshRequestBody({ requestedScopes: ["delegated.payment.change"] })),
  });
  assert.equal(res.status, 400);
});

test("the challenge plaintext is never persisted — only its hash", async () => {
  currentActor = PRO;
  const res = await createRequest();
  const { requestId, challenge } = (await res.json()) as {
    requestId: string;
    challenge: string;
  };
  const stored = await mandates.findRequestById(requestId);
  assert.ok(stored);
  assert.notEqual(stored.challengeHash, challenge);
  assert.ok(!JSON.stringify(stored).includes(challenge));
});

test("the challenge never reaches the audit log", async () => {
  currentActor = PRO;
  const res = await createRequest();
  const { challenge } = (await res.json()) as { challenge: string };
  const serialised = JSON.stringify(audit.events ?? []);
  assert.ok(!serialised.includes(challenge));
});

// ---------------------------------------------------------------------------
// Accept — the self-dealing guard is the most important property here.
// ---------------------------------------------------------------------------

test("a professional cannot accept their own request — self-dealing is refused at the HTTP layer", async () => {
  currentActor = PRO;
  const created = await createRequest();
  const { requestId, challenge } = (await created.json()) as {
    requestId: string;
    challenge: string;
  };

  // Same actor who created the request now attempts to accept it as though
  // they were the client. Even though the domain layer's guard #2 compares
  // authenticatedUserRef to request.professionalUserRef, this proves the
  // route never lets a professional session masquerade as the client.
  currentActor = PRO;
  const before = (await mandates.findActiveMandatesForProfessional(PRO)).length;
  const res = await accept({ requestId, challenge, portfolioRef: "portfolio-1" });
  assert.equal(res.status, 403);

  const after = (await mandates.findActiveMandatesForProfessional(PRO)).length;
  assert.equal(after, before, "a mandate must never be created via self-acceptance");
});

test("a third party cannot accept a mandate on the client's behalf", async () => {
  currentActor = PRO;
  const created = await createRequest();
  const { requestId, challenge } = (await created.json()) as {
    requestId: string;
    challenge: string;
  };
  currentActor = "actor-somebody-else";
  const res = await accept({ requestId, challenge, portfolioRef: "portfolio-1" });
  assert.equal(res.status, 403);
});

test("the client can accept a valid request", async () => {
  const { mandateId } = await createAndAccept();
  assert.ok(mandateId);
});

test("a request cannot be accepted twice", async () => {
  currentActor = PRO;
  const created = await createRequest();
  const { requestId, challenge } = (await created.json()) as {
    requestId: string;
    challenge: string;
  };
  currentActor = CLIENT;
  assert.equal(
    (await accept({ requestId, challenge, portfolioRef: "portfolio-1" })).status,
    201,
  );
  assert.equal(
    (await accept({ requestId, challenge, portfolioRef: "portfolio-1" })).status,
    403,
  );
});

test("an expired request is refused", async () => {
  currentActor = PRO;
  const created = await createRequest(freshRequestBody({ ttlSeconds: 60 }));
  const { requestId, challenge } = (await created.json()) as {
    requestId: string;
    challenge: string;
  };
  const original = clock;
  clock = new Date(original.getTime() + 61 * 1000);
  try {
    currentActor = CLIENT;
    assert.equal(
      (await accept({ requestId, challenge, portfolioRef: "portfolio-1" })).status,
      403,
    );
  } finally {
    clock = original;
  }
});

test("a wrong challenge does NOT consume the request", async () => {
  currentActor = PRO;
  const created = await createRequest();
  const { requestId, challenge } = (await created.json()) as {
    requestId: string;
    challenge: string;
  };

  currentActor = CLIENT;
  assert.equal(
    (await accept({ requestId, challenge: "wrong-challenge", portfolioRef: "portfolio-1" }))
      .status,
    403,
  );
  const stored = await mandates.findRequestById(requestId);
  assert.equal(stored?.consumedAt, null, "request was burned by a failed attempt");

  // The real challenge still works afterwards.
  assert.equal(
    (await accept({ requestId, challenge, portfolioRef: "portfolio-1" })).status,
    201,
  );
});

test("every accept denial returns an identical body — no enumeration oracle", async () => {
  currentActor = PRO;
  const created = await createRequest();
  const { requestId, challenge } = (await created.json()) as {
    requestId: string;
    challenge: string;
  };
  currentActor = CLIENT;
  await accept({ requestId, challenge, portfolioRef: "portfolio-1" }); // consume it

  const bodies = await Promise.all([
    accept({ requestId, challenge, portfolioRef: "portfolio-1" }).then((r) => r.text()), // consumed
    accept({ requestId: "req-nope", challenge, portfolioRef: "portfolio-1" }).then((r) =>
      r.text(),
    ), // not found
    accept({ requestId, challenge: "bad", portfolioRef: "portfolio-1" }).then((r) => r.text()), // wrong challenge
  ]);
  assert.equal(new Set(bodies).size, 1, `denial bodies differ: ${JSON.stringify(bodies)}`);
});

// ---------------------------------------------------------------------------
// GET /delegation/mandates
// ---------------------------------------------------------------------------

test("mandates list is scoped to the caller as client", async () => {
  const { mandateId } = await createAndAccept();

  currentActor = CLIENT;
  const res = await listMandates();
  const body = (await res.json()) as { mandates: { mandateId: string; role: string }[] };
  assert.ok(body.mandates.some((m) => m.mandateId === mandateId && m.role === "client"));
});

test("mandates list is scoped to the caller as professional", async () => {
  const { mandateId } = await createAndAccept();

  currentActor = PRO;
  const res = await listMandates();
  const body = (await res.json()) as { mandates: { mandateId: string; role: string }[] };
  assert.ok(body.mandates.some((m) => m.mandateId === mandateId && m.role === "professional"));
});

test("an unrelated actor sees no mandates", async () => {
  await createAndAccept();

  currentActor = "actor-unrelated";
  const res = await listMandates();
  const body = (await res.json()) as { mandates: unknown[] };
  assert.deepEqual(body.mandates, []);
});

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

test("the client can revoke the mandate", async () => {
  const { mandateId, version } = await createAndAccept();
  currentActor = CLIENT;
  const res = await revoke(mandateId, version);
  assert.equal(res.status, 200);
});

test("the professional can also revoke the mandate", async () => {
  const { mandateId, version } = await createAndAccept();
  currentActor = PRO;
  const res = await revoke(mandateId, version);
  assert.equal(res.status, 200);
});

test("an unrelated actor cannot revoke the mandate", async () => {
  const { mandateId, version } = await createAndAccept();
  currentActor = "actor-unrelated";
  const res = await revoke(mandateId, version);
  assert.equal(res.status, 403);
});

test("a stale version cannot revoke", async () => {
  const { mandateId, version } = await createAndAccept();
  currentActor = CLIENT;
  assert.equal((await revoke(mandateId, version + 99)).status, 403);
  assert.equal((await revoke(mandateId, version)).status, 200);
});

test("revoking twice fails the second time", async () => {
  const { mandateId, version } = await createAndAccept();
  currentActor = CLIENT;
  assert.equal((await revoke(mandateId, version)).status, 200);
  assert.equal((await revoke(mandateId, version)).status, 403);
});

test("revoke requires an authenticated session", async () => {
  const { mandateId, version } = await createAndAccept();
  const previous = currentActor;
  currentActor = null;
  try {
    assert.equal((await revoke(mandateId, version)).status, 401);
  } finally {
    currentActor = previous;
  }
});
