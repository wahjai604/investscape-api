/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 2 route tests.
 *
 * These run against a REAL Express app on an ephemeral port, driven with
 * `fetch`. Not because it is fashionable — because the properties under test
 * (raw-body capture, header parsing, middleware ordering, status codes) live in
 * the HTTP layer itself. Asserting them against a hand-built fake `req` object
 * would prove that the fake behaves as written, which is not the question.
 *
 * Hermetic: no database, no network beyond loopback, injected clock.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createLinkRouter } from "./linkRoute.ts";
import { InMemoryLinkRepository } from "./linkRepository.ts";
import { InMemoryNonceStore } from "../service-auth/nonceStore.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";
import { signRequest } from "../service-auth/hmac.ts";
import { hashChallenge } from "../domain/crossProductLink.ts";

const KEY_ID = "ros-to-is-test";
const SECRET = "a".repeat(64);
const ENABLED = { LIGHTHOUSE_FF_CROSS_PRODUCT_IDENTITY_LINKING: "true" };
const DISABLED = { LIGHTHOUSE_FF_CROSS_PRODUCT_IDENTITY_LINKING: "false" };

let server: Server;
let baseUrl: string;
let links: InMemoryLinkRepository;
let audit: InMemoryAuditSink;
let nonces: InMemoryNonceStore;
let clock: Date;
let env: Record<string, string | undefined>;
/** Set to null to simulate an unauthenticated caller. */
let currentActor: string | null;
let invitationCounter: number;

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

  links = new InMemoryLinkRepository();
  audit = new InMemoryAuditSink();
  nonces = new InMemoryNonceStore();
  clock = new Date("2026-09-02T12:00:00.000Z");
  env = { ...ENABLED };
  currentActor = "actor-investscape-1";
  invitationCounter = 0;

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
    createLinkRouter({
      links,
      auditSink: audit,
      nonces,
      inboundSecrets: { [KEY_ID]: SECRET },
      now: () => clock,
      newInvitationId: () => `inv-${++invitationCounter}`,
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

const PATH = "/v1/lighthouse/link/invitations";

/**
 * Each call defaults to a FRESH person ref.
 *
 * Tests share one in-memory repository, and `uq_cross_product_links_active_pair`
 * (mirrored by the in-memory duplicate check) means a second link for the same
 * (person, actor) pair is adopted rather than created — a legitimate behaviour
 * that would otherwise make later tests depend on which earlier tests ran.
 */
let personCounter = 0;
function freshInvitationBody(): Record<string, unknown> {
  personCounter += 1;
  return {
    relationshipOsPersonRef: `ros-person-${personCounter}`,
    relationshipRef: `rel-${personCounter}`,
    noticeVersion: "notice-v1",
  };
}

async function createInvitation(
  body: unknown = undefined,
  overrides: { keyId?: string; secret?: string; nonce?: string; service?: string } = {},
): Promise<Response> {
  body = body ?? freshInvitationBody();
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

async function accept(invitationId: string, challenge: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/link/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invitationId, challenge }),
  });
}

async function mintAndAccept(): Promise<{ linkId: string; version: number }> {
  const created = await createInvitation();
  const { invitationId, challenge } = (await created.json()) as {
    invitationId: string;
    challenge: string;
  };
  const res = await accept(invitationId, challenge);
  const body = (await res.json()) as { crossProductLinkId: string; version: number };
  return { linkId: body.crossProductLinkId, version: body.version };
}

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

test("every route is 503 while the feature flag is off", async () => {
  Object.assign(env, DISABLED);
  try {
    const invitation = await createInvitation();
    assert.equal(invitation.status, 503);

    const acceptRes = await accept("inv-x", "challenge");
    assert.equal(acceptRes.status, 503);

    const status = await fetch(`${baseUrl}/v1/lighthouse/link/status`);
    assert.equal(status.status, 503);

    const unlink = await fetch(`${baseUrl}/v1/lighthouse/link/abc/unlink`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    assert.equal(unlink.status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

test("the flag is checked before schema validation and before any repository work", async () => {
  // Note what this does NOT claim: express.json() is app-level middleware, so
  // JSON parsing necessarily happens before any router runs. Malformed JSON to
  // a disabled endpoint therefore yields 400, not 503, and that is correct.
  // What matters is that the flag short-circuits everything THIS router does.
  Object.assign(env, DISABLED);
  try {
    // Well-formed JSON that would fail the accept schema. A 400 would prove
    // validation ran despite the flag being off.
    const res = await fetch(`${baseUrl}/v1/lighthouse/link/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonsense: true }),
    });
    assert.equal(res.status, 503);

    const countBefore = (audit.events ?? []).length;
    await accept("inv-1", "challenge");
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
// Invitation creation — service authentication
// ---------------------------------------------------------------------------

test("a correctly signed invitation request is accepted", async () => {
  const res = await createInvitation();
  assert.equal(res.status, 201);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.state, "created");
  assert.ok(typeof body.challenge === "string" && (body.challenge as string).length >= 40);
});

test("an unsigned invitation request is rejected", async () => {
  const res = await fetch(`${baseUrl}${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      relationshipOsPersonRef: "p", relationshipRef: "r", noticeVersion: "v1",
    }),
  });
  assert.equal(res.status, 401);
});

test("a request signed with the wrong secret is rejected", async () => {
  const res = await createInvitation(undefined, { secret: "b".repeat(64) });
  assert.equal(res.status, 401);
});

test("a request signed by an unknown key id is rejected", async () => {
  const res = await createInvitation(undefined, { keyId: "unknown-key" });
  assert.equal(res.status, 401);
});

test("a request claiming to be a different service is rejected", async () => {
  const res = await createInvitation(undefined, { service: "some-other-service" });
  assert.equal(res.status, 401);
});

test("a replayed nonce is rejected even though the signature is valid", async () => {
  const nonce = "c".repeat(32);
  const first = await createInvitation(undefined, { nonce });
  assert.equal(first.status, 201);
  // Byte-identical replay: same body, same signature, same nonce.
  const replay = await createInvitation(undefined, { nonce });
  assert.equal(replay.status, 401);
});

test("tampering with the body after signing is rejected", async () => {
  const signedBody = JSON.stringify({
    relationshipOsPersonRef: "ros-person-1", relationshipRef: "rel-1", noticeVersion: "v1",
  });
  const headers = signRequest({
    serviceName: "relationship-os", keyId: KEY_ID, secret: SECRET,
    method: "POST", path: PATH, rawBody: signedBody,
    now: () => Math.floor(clock.getTime() / 1000),
  });
  const res = await fetch(`${baseUrl}${PATH}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    // Same fields, different person. Signature no longer matches the bytes.
    body: JSON.stringify({
      relationshipOsPersonRef: "ros-person-ATTACKER",
      relationshipRef: "rel-1", noticeVersion: "v1",
    }),
  });
  assert.equal(res.status, 401);
});

test("an email field is rejected rather than ignored", async () => {
  const res = await createInvitation({
    relationshipOsPersonRef: "p", relationshipRef: "r", noticeVersion: "v1",
    email: "someone@example.com",
  });
  // .strict() turns an unexpected field into a 400. Silent ignoring would let
  // an email-linking contract drift in unnoticed.
  assert.equal(res.status, 400);
});

test("the challenge plaintext is never persisted — only its hash", async () => {
  const res = await createInvitation();
  const { invitationId, challenge } = (await res.json()) as {
    invitationId: string; challenge: string;
  };
  const stored = await links.findInvitation(invitationId);
  assert.ok(stored);
  assert.equal(stored.challengeHash, hashChallenge(challenge));
  const serialised = JSON.stringify(stored);
  assert.ok(!serialised.includes(challenge), "plaintext challenge found in stored record");
});

test("the challenge never reaches the audit log", async () => {
  const res = await createInvitation();
  const { challenge } = (await res.json()) as { challenge: string };
  const serialised = JSON.stringify(audit.events ?? []);
  assert.ok(!serialised.includes(challenge), "plaintext challenge found in audit events");
});

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

test("a valid challenge creates a link", async () => {
  const created = await createInvitation();
  const { invitationId, challenge } = (await created.json()) as {
    invitationId: string; challenge: string;
  };
  const res = await accept(invitationId, challenge);
  assert.equal(res.status, 201);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.state, "linked");
  assert.ok(body.crossProductLinkId);
});

test("a confirmed link grants nothing", async () => {
  const created = await createInvitation();
  const { invitationId, challenge } = (await created.json()) as {
    invitationId: string; challenge: string;
  };
  const res = await accept(invitationId, challenge);
  const body = (await res.json()) as { grants: unknown[] };
  assert.deepEqual(body.grants, [], "a link must confer no capabilities");
});

test("an invitation cannot be accepted twice", async () => {
  const created = await createInvitation();
  const { invitationId, challenge } = (await created.json()) as {
    invitationId: string; challenge: string;
  };
  assert.equal((await accept(invitationId, challenge)).status, 201);
  assert.equal((await accept(invitationId, challenge)).status, 403);
});

test("a wrong challenge does NOT consume the invitation", async () => {
  // The compare-before-consume decision recorded in linkRepository.ts. If this
  // inverts, an attacker who learns an invitationId can destroy it at will.
  const created = await createInvitation();
  const { invitationId, challenge } = (await created.json()) as {
    invitationId: string; challenge: string;
  };
  assert.equal((await accept(invitationId, "wrong-challenge")).status, 403);
  const stored = await links.findInvitation(invitationId);
  assert.equal(stored?.consumedAt, null, "invitation was burned by a failed attempt");
  // The real challenge still works afterwards.
  assert.equal((await accept(invitationId, challenge)).status, 201);
});

test("an expired invitation is refused", async () => {
  const created = await createInvitation();
  const { invitationId, challenge } = (await created.json()) as {
    invitationId: string; challenge: string;
  };
  const original = clock;
  clock = new Date(original.getTime() + 16 * 60 * 1000); // past the 15 min TTL
  try {
    assert.equal((await accept(invitationId, challenge)).status, 403);
  } finally {
    clock = original;
  }
});

test("an unknown invitation is refused", async () => {
  assert.equal((await accept("inv-does-not-exist", "whatever")).status, 403);
});

test("accept requires an authenticated session", async () => {
  const created = await createInvitation();
  const { invitationId, challenge } = (await created.json()) as {
    invitationId: string; challenge: string;
  };
  const previous = currentActor;
  currentActor = null;
  try {
    assert.equal((await accept(invitationId, challenge)).status, 401);
  } finally {
    currentActor = previous;
  }
});

test("every denial returns an identical body — no enumeration oracle", async () => {
  const created = await createInvitation();
  const { invitationId, challenge } = (await created.json()) as {
    invitationId: string; challenge: string;
  };
  await accept(invitationId, challenge); // consume it

  const bodies = await Promise.all([
    accept(invitationId, challenge).then((r) => r.text()),      // already consumed
    accept("inv-nope", challenge).then((r) => r.text()),        // not found
    accept(invitationId, "bad").then((r) => r.text()),          // wrong challenge
  ]);
  assert.equal(new Set(bodies).size, 1, `denial bodies differ: ${JSON.stringify(bodies)}`);
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

test("status returns only the caller's own links", async () => {
  await mintAndAccept();

  const mine = await fetch(`${baseUrl}/v1/lighthouse/link/status`);
  const mineBody = (await mine.json()) as { links: unknown[] };
  assert.ok(mineBody.links.length >= 1);

  const previous = currentActor;
  currentActor = "actor-somebody-else";
  try {
    const theirs = await fetch(`${baseUrl}/v1/lighthouse/link/status`);
    const theirsBody = (await theirs.json()) as { links: unknown[] };
    assert.deepEqual(theirsBody.links, [], "another actor saw links that are not theirs");
  } finally {
    currentActor = previous;
  }
});

test("status requires an authenticated session", async () => {
  const previous = currentActor;
  currentActor = null;
  try {
    const res = await fetch(`${baseUrl}/v1/lighthouse/link/status`);
    assert.equal(res.status, 401);
  } finally {
    currentActor = previous;
  }
});

// ---------------------------------------------------------------------------
// Unlink
// ---------------------------------------------------------------------------

async function unlink(linkId: string, expectedVersion: number): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/link/${linkId}/unlink`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion }),
  });
}

test("an actor can unlink their own link", async () => {
  const { linkId, version } = await mintAndAccept();
  const res = await unlink(linkId, version);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.state, "unlinked");
  // Share revocation is not wired yet; the response must not imply it happened.
  assert.equal(body.sharesRevoked, null);
});

test("an actor cannot unlink somebody else's link", async () => {
  const { linkId, version } = await mintAndAccept();
  const previous = currentActor;
  currentActor = "actor-somebody-else";
  try {
    assert.equal((await unlink(linkId, version)).status, 403);
  } finally {
    currentActor = previous;
  }
  // And it is still intact for the real owner.
  const still = await links.findLinkById(linkId);
  assert.equal(still?.lifecycle.state, "active");
});

test("a stale version cannot unlink", async () => {
  const { linkId, version } = await mintAndAccept();
  assert.equal((await unlink(linkId, version + 99)).status, 403);
  assert.equal((await unlink(linkId, version)).status, 200);
});

test("unlinking twice fails the second time", async () => {
  const { linkId, version } = await mintAndAccept();
  assert.equal((await unlink(linkId, version)).status, 200);
  assert.equal((await unlink(linkId, version)).status, 403);
});

test("unlink requires an authenticated session", async () => {
  const { linkId, version } = await mintAndAccept();
  const previous = currentActor;
  currentActor = null;
  try {
    assert.equal((await unlink(linkId, version)).status, 401);
  } finally {
    currentActor = previous;
  }
});
