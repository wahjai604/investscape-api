/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 3 route tests. Same structure as stage2/stage2Route.test.ts: a real
 * Express app on an ephemeral port, driven with `fetch`. Hermetic — no
 * database, injected clock.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createWorkspaceDisclosureRouter } from "./workspaceDisclosureRoute.ts";
import { InMemoryWorkspaceDisclosureRepository } from "./workspaceDisclosureRepository.ts";
import { InMemoryLinkRepository } from "../stage2/linkRepository.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";
import { generateChallenge, hashChallenge } from "../domain/crossProductLink.ts";

const ENABLED = { LIGHTHOUSE_FF_CLIENT_WORKSPACE_DISCLOSURE: "true" };
const DISABLED = { LIGHTHOUSE_FF_CLIENT_WORKSPACE_DISCLOSURE: "false" };

let server: Server;
let baseUrl: string;
let links: InMemoryLinkRepository;
let disclosures: InMemoryWorkspaceDisclosureRepository;
let audit: InMemoryAuditSink;
let clock: Date;
let env: Record<string, string | undefined>;
let currentActor: string | null;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  links = new InMemoryLinkRepository();
  disclosures = new InMemoryWorkspaceDisclosureRepository();
  audit = new InMemoryAuditSink();
  clock = new Date("2026-09-02T12:00:00.000Z");
  env = { ...ENABLED };
  currentActor = "actor-investscape-1";

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
    createWorkspaceDisclosureRouter({
      links,
      disclosures,
      auditSink: audit,
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
// Helpers — create an active link owned by `currentActor` directly through
// the domain function, bypassing Stage 2's HTTP surface (out of scope here).
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

async function setConsent(
  relationshipRef: string,
  crossProductLinkId: string,
  consented: boolean,
): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/workspace-disclosure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ relationshipRef, crossProductLinkId, consented }),
  });
}

async function getConsent(relationshipRef: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/lighthouse/workspace-disclosure/${relationshipRef}`);
}

// ---------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------

test("every route is 503 while the feature flag is off", async () => {
  Object.assign(env, DISABLED);
  try {
    const setRes = await setConsent("rel-x", "link-x", true);
    assert.equal(setRes.status, 503);
    const getRes = await getConsent("rel-x");
    assert.equal(getRes.status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

test("the flag is checked before schema validation", async () => {
  Object.assign(env, DISABLED);
  try {
    const res = await fetch(`${baseUrl}/v1/lighthouse/workspace-disclosure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonsense: true }),
    });
    assert.equal(res.status, 503);
  } finally {
    Object.assign(env, ENABLED);
  }
});

// ---------------------------------------------------------------------------
// POST /workspace-disclosure
// ---------------------------------------------------------------------------

test("requires an authenticated session", async () => {
  const previous = currentActor;
  currentActor = null;
  try {
    const res = await setConsent("rel-1", "link-1", true);
    assert.equal(res.status, 401);
  } finally {
    currentActor = previous;
  }
});

test("rejects an unexpected field", async () => {
  const res = await fetch(`${baseUrl}/v1/lighthouse/workspace-disclosure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      relationshipRef: "rel-1", crossProductLinkId: "link-1",
      consented: true, extra: "nope",
    }),
  });
  assert.equal(res.status, 400);
});

test("a caller cannot set consent against a link they do not own", async () => {
  const linkId = await createActiveLink("actor-owner", "rel-owned");
  const res = await setConsent("rel-owned", linkId, true);
  // currentActor is "actor-investscape-1", not "actor-owner".
  assert.equal(res.status, 403);
});

test("a caller can set and revoke consent for their own link", async () => {
  const linkId = await createActiveLink(currentActor!, "rel-mine");

  const setRes = await setConsent("rel-mine", linkId, true);
  assert.equal(setRes.status, 200);
  const setBody = (await setRes.json()) as { consented: boolean; consentedAt: string | null };
  assert.equal(setBody.consented, true);
  assert.ok(setBody.consentedAt);

  const getRes = await getConsent("rel-mine");
  const getBody = (await getRes.json()) as { consented: boolean };
  assert.equal(getBody.consented, true);

  const revokeRes = await setConsent("rel-mine", linkId, false);
  assert.equal(revokeRes.status, 200);
  const revokeBody = (await revokeRes.json()) as { consented: boolean; revokedAt: string | null };
  assert.equal(revokeBody.consented, false);
  assert.ok(revokeBody.revokedAt);
});

test("consent is scoped to the caller — another actor sees none", async () => {
  const linkId = await createActiveLink(currentActor!, "rel-scoped");
  await setConsent("rel-scoped", linkId, true);

  const previous = currentActor;
  currentActor = "actor-somebody-else";
  try {
    const res = await getConsent("rel-scoped");
    const body = (await res.json()) as { consented: boolean };
    assert.equal(body.consented, false, "another actor read consent that is not theirs");
  } finally {
    currentActor = previous;
  }
});

test("an unknown relationship returns a default 'not consented' shape rather than an error", async () => {
  const res = await getConsent("rel-never-set");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { consented: boolean; version: number };
  assert.equal(body.consented, false);
  assert.equal(body.version, 0);
});

test("setting consent for a nonexistent link is denied", async () => {
  const res = await setConsent("rel-ghost", "link-does-not-exist", true);
  assert.equal(res.status, 403);
});
