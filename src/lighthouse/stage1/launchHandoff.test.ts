/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 1 sign-in handoff: sealing, single-use claim, the redeem-after-sign-in
 * path, and the "a launch code never reaches a log or persistent browser
 * storage" guarantees.
 *
 * Hermetic: no database, loopback-only HTTP, injected clock. Flags are
 * injected per test app; configuration keeps them all off.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Server } from "node:http";

import {
  HANDOFF_TTL_SECONDS,
  InMemoryLaunchHandoffRepository,
  generateHandoffToken,
  hashHandoffToken,
  openHandoff,
  sealHandoff,
} from "./launchHandoff.ts";
import { createLaunchRouter } from "./launchRoute.ts";
import { InMemoryAnalysisBindingRepository } from "./analysisBinding.ts";
import { InMemoryLinkRepository } from "../stage2/linkRepository.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";
import { generateChallenge, hashChallenge } from "../domain/crossProductLink.ts";
import { errorHandler } from "../../middleware/errorHandler.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-09-28T12:00:00.000Z");
const SESSION = "11111111-2222-3333-4444-555555555555";
const CODE = "launch-code-" + "z".repeat(40);
const PRO = "actor-professional-P";
const OTHER_PRO = "actor-professional-Q";
const ROS_PRO = "ros-person-P";

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

describe("handoff sealing", () => {
  const token = generateHandoffToken();
  const sealed = sealHandoff({ handoffId: "h-1", token, launchSessionId: SESSION, code: CODE, now: NOW });

  test("the token is 256 bits of base64url and the stored hash is not the token", () => {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(sealed.tokenHash, hashHandoffToken(token));
    assert.notEqual(sealed.tokenHash, token);
  });

  test("the stored record never contains the code or the token", () => {
    const stored = JSON.stringify(sealed);
    assert.equal(stored.includes(CODE), false);
    assert.equal(stored.includes(token), false);
  });

  test("only the right token opens it", () => {
    assert.equal(openHandoff(sealed, token), CODE);
    assert.equal(openHandoff(sealed, generateHandoffToken()), null);
  });

  test("ciphertext is bound to its handoff and launch session (no transplanting)", () => {
    assert.equal(openHandoff({ ...sealed, launchSessionId: "11111111-2222-3333-4444-000000000000" }, token), null);
    assert.equal(openHandoff({ ...sealed, handoffId: "h-2" }, token), null);
  });

  test("tampered ciphertext fails closed rather than throwing", () => {
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] = flipped[0]! ^ 0xff;
    assert.equal(openHandoff({ ...sealed, ciphertext: flipped.toString("base64") }, token), null);
  });

  test("TTL is ten minutes", () => {
    assert.equal(HANDOFF_TTL_SECONDS, 600);
    assert.equal(new Date(sealed.expiresAt).getTime() - NOW.getTime(), 600_000);
  });
});

describe("handoff repository (in-memory)", () => {
  test("claim is single-use and wipes the ciphertext", async () => {
    const repo = new InMemoryLaunchHandoffRepository();
    const token = generateHandoffToken();
    const sealed = sealHandoff({ handoffId: "h-1", token, launchSessionId: SESSION, code: CODE, now: NOW });
    await repo.create(sealed);
    assert.ok(await repo.claim(sealed.tokenHash, PRO, NOW));
    assert.equal(repo.holdsCiphertext(sealed.tokenHash), false);
    assert.equal(await repo.claim(sealed.tokenHash, PRO, NOW), null);
  });

  test("an expired handoff cannot be claimed", async () => {
    const repo = new InMemoryLaunchHandoffRepository();
    const token = generateHandoffToken();
    const sealed = sealHandoff({ handoffId: "h-1", token, launchSessionId: SESSION, code: CODE, now: NOW });
    await repo.create(sealed);
    assert.equal(await repo.claim(sealed.tokenHash, PRO, new Date(NOW.getTime() + 600_000)), null);
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe("handoff routes", () => {
  let server: Server;
  let baseUrl: string;
  let handoffs: InMemoryLaunchHandoffRepository;
  let bindings: InMemoryAnalysisBindingRepository;
  let audit: InMemoryAuditSink;
  let actor: string | null;
  let clock: Date;
  let resumeUrl: string | null;
  let redemptionBodies: string[];
  let handoffCounter = 0;

  before(async () => {
    handoffs = new InMemoryLaunchHandoffRepository();
    bindings = new InMemoryAnalysisBindingRepository();
    audit = new InMemoryAuditSink();
    const links = new InMemoryLinkRepository();
    for (const [actorRef, person] of [[PRO, ROS_PRO], [OTHER_PRO, "ros-person-Q"]] as const) {
      const challenge = generateChallenge();
      await links.createInvitation({
        invitationId: `inv-${actorRef}`, challengeHash: hashChallenge(challenge),
        relationshipOsPersonRef: person, relationshipRef: "rel", expiresAt: "2026-09-28T12:15:00.000Z",
        noticeVersion: "v1", correlationId: "c", consumedAt: null,
      });
      await links.accept({
        invitationId: `inv-${actorRef}`, presentedChallenge: challenge, investscapeActorRef: actorRef,
        correlationId: "c", now: NOW, isEnabled: true,
      });
    }

    const app = express();
    app.use(express.json());
    app.use(
      "/v1/lighthouse",
      (req, _res, next) => {
        if (actor) req.lighthouseSession = { actorRef: actor } as never;
        next();
      },
      createLaunchRouter({
        config: { baseUrl: "https://relationship-os.example.test", keyId: "k", secret: "s".repeat(64) },
        redemption: {
          fetch: (async (_url: string, init: RequestInit) => {
            redemptionBodies.push(String(init.body));
            const body = JSON.parse(String(init.body)) as { launchSessionId: string };
            return new Response(JSON.stringify({
              schemaVersion: "investscape-launch-context.v2",
              launchSessionId: body.launchSessionId,
              analysisType: "investment_quick_review",
              modules: ["property_overview"], permittedScopes: ["property.basic"], redactedScopes: [],
              expiresAt: "2026-09-28T12:05:00.000Z",
              context: { property: { propertyRef: "prop-1" } },
              correlationId: "corr-1",
              initiatingProfessional: { relationshipOsPersonRef: ROS_PRO },
            }), { status: 200, headers: { "content-type": "application/json" } });
          }) as typeof fetch,
          now: () => Math.floor(NOW.getTime() / 1000),
          newOperationId: () => "op-1",
        },
        bindings,
        links,
        handoffs,
        get appResumeUrl() { return resumeUrl; },
        newHandoffId: () => `handoff-${++handoffCounter}`,
        auditSink: audit,
        newAnalysisId: () => `analysis-${handoffCounter}`,
        now: () => clock,
        env: { LIGHTHOUSE_FF_STAGE1_LAUNCH_RECEIVER: "true" },
      }),
    );
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("no port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    actor = null;
    clock = NOW;
    resumeUrl = "https://app.investscape.example/relationship-os/resume";
    redemptionBodies = [];
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}/v1/lighthouse${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });

  async function createHandoff(session = SESSION): Promise<string> {
    const res = await post("/launch/handoffs", { launchSessionId: session, code: CODE });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, string>;
    assert.equal(body.state, "handoff_created");
    return body.handoffToken!;
  }

  test("a signed-out landing page can seal a handoff; the response carries the token and resume URL, never the code", async () => {
    const res = await post("/launch/handoffs", { launchSessionId: SESSION, code: CODE });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes(CODE), false);
    const body = JSON.parse(text) as Record<string, string>;
    assert.match(body.handoffToken!, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.resumeUrl, resumeUrl);
    assert.equal(redemptionBodies.length, 0, "sealing never contacts Relationship OS");
  });

  test("no audit event ever contains the code, the token, or the token hash", async () => {
    const token = await createHandoff();
    const trail = JSON.stringify(audit.events);
    assert.equal(trail.includes(CODE), false);
    assert.equal(trail.includes(token), false);
    assert.equal(trail.includes(hashHandoffToken(token)), false);
  });

  test("without a configured app resume URL nothing is stored and the page reports unavailable", async () => {
    resumeUrl = null;
    const res = await post("/launch/handoffs", { launchSessionId: SESSION, code: CODE });
    assert.equal(res.status, 503);
  });

  test("a malformed launch session id is refused before anything is stored", async () => {
    const res = await post("/launch/handoffs", { launchSessionId: "not-a-uuid", code: CODE });
    assert.equal(res.status, 400);
  });

  test("redeeming a handoff requires a session", async () => {
    const token = await createHandoff();
    actor = null;
    assert.equal((await post("/launch/handoffs/redeem", { handoffToken: token })).status, 401);
    assert.equal(handoffs.holdsCiphertext(hashHandoffToken(token)), true, "not consumed");
  });

  test("an unlinked signed-in user is refused and the handoff is NOT burned", async () => {
    const token = await createHandoff();
    actor = "actor-with-no-link";
    assert.equal((await post("/launch/handoffs/redeem", { handoffToken: token })).status, 403);
    assert.equal(handoffs.holdsCiphertext(hashHandoffToken(token)), true);
    assert.equal(redemptionBodies.length, 0, "code not sent to Relationship OS");
  });

  test("the confirmed-linked initiator resumes after sign-in: code redeemed once, analysis bound to them, handoff wiped", async () => {
    const token = await createHandoff("11111111-2222-3333-4444-000000000011");
    actor = PRO;
    const res = await post("/launch/handoffs/redeem", { handoffToken: token });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.state, "success");
    assert.equal(body.operatingContext, "professional_assisted");
    assert.equal(redemptionBodies.length, 1);
    assert.equal(JSON.parse(redemptionBodies[0]!).code, CODE, "the sealed code, decrypted in memory, is what reaches RoS");
    assert.equal((await bindings.findByLaunchSession("11111111-2222-3333-4444-000000000011"))?.professionalActorRef, PRO);
    assert.equal(handoffs.holdsCiphertext(hashHandoffToken(token)), false);
  });

  test("a handoff is single-use", async () => {
    const token = await createHandoff("11111111-2222-3333-4444-000000000012");
    actor = PRO;
    assert.equal((await post("/launch/handoffs/redeem", { handoffToken: token })).status, 200);
    assert.equal((await post("/launch/handoffs/redeem", { handoffToken: token })).status, 410);
  });

  test("a linked professional who is NOT the initiator cannot use someone else's handoff", async () => {
    const token = await createHandoff("11111111-2222-3333-4444-000000000013");
    actor = OTHER_PRO;
    assert.equal((await post("/launch/handoffs/redeem", { handoffToken: token })).status, 403);
    assert.equal(await bindings.findByLaunchSession("11111111-2222-3333-4444-000000000013"), null);
  });

  test("an expired handoff answers 410 and never reaches Relationship OS", async () => {
    const token = await createHandoff();
    actor = PRO;
    clock = new Date(NOW.getTime() + 600_000);
    assert.equal((await post("/launch/handoffs/redeem", { handoffToken: token })).status, 410);
    assert.equal(redemptionBodies.length, 0);
  });

  test("an unknown or malformed token is refused without revealing which", async () => {
    actor = PRO;
    assert.equal((await post("/launch/handoffs/redeem", { handoffToken: generateHandoffToken() })).status, 410);
    assert.equal((await post("/launch/handoffs/redeem", { handoffToken: "short" })).status, 400);
  });
});

// ---------------------------------------------------------------------------
// Logs and the landing page
// ---------------------------------------------------------------------------

describe("launch codes never reach logs", () => {
  test("a malformed JSON body carrying a code is logged by type only, and the query string is not logged", async () => {
    const app = express();
    app.use(express.json());
    app.post("/v1/lighthouse/launch/handoffs", (_req, res) => { res.json({}); });
    app.use(errorHandler);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("no port");

    const captured: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { captured.push(args.map((a) => JSON.stringify(a) ?? String(a)).join(" ")); };
    try {
      await fetch(`http://127.0.0.1:${address.port}/v1/lighthouse/launch/handoffs?code=${CODE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"launchSessionId":"${SESSION}","code":"${CODE}"`, // truncated: invalid JSON
      });
    } finally {
      console.error = original;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const logged = captured.join("\n");
    assert.ok(logged.includes("entity.parse.failed"), "the failure is still diagnosable");
    assert.equal(logged.includes(CODE), false, "code leaked into the error log");
    assert.equal(logged.includes("?code="), false, "query string leaked into the error log");
  });

  test("the landing script seals and forwards; it never redeems, stores, or logs the code", () => {
    const source = readFileSync(join(HERE, "..", "..", "..", "public", "relationship-os-launch.js"), "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(code, /'\/v1\/lighthouse\/launch\/handoffs'/);
    assert.equal(/launch\/redeem/.test(code), false);
    assert.equal(/localStorage|sessionStorage|document\.cookie|indexedDB|console\./.test(code), false);
    assert.match(code, /u\.hash = 'handoff=' \+ encodeURIComponent\(token\)/, "token travels in the fragment");
    assert.match(code, /history\.replaceState\(null, '', location\.pathname\)/, "query scrubbed before any request");
  });
});
