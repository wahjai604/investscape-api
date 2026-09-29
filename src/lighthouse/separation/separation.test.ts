/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * P1 context-separation tests.
 *
 * Four contexts must never bleed into each other:
 *   1. a client's personal workspace
 *   2. a professional's personal workspace
 *   3. a professional's relationship-scoped (launched) analysis
 *   4. analyses a client has explicitly shared
 *
 * Covers: launch ownership and context, non-enumeration of unshared analyses,
 * "linking grants nothing", wrong user / relationship / recipient, revoked /
 * expired grants, atomic unlink revocation, analysis ownership, fixed
 * recipient types, disabled delegation, and the production middleware wiring.
 *
 * Regression tests for P1 defects 1-6 are labelled `DEFECT-n` in their names.
 *
 * Feature flags: every flag stays off in configuration. Routers and the
 * bootstrap receive an injected `env` object only, as the stage route tests do.
 *
 * Hermetic: no database, loopback-only HTTP, injected clock. The SQL paths
 * (transactional unlink, ownership query, migration 0013) are covered here by
 * a recording fake client and static checks; executing them against Postgres
 * is the job of the *.dbtest.ts suites.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Server } from "node:http";

import { createLaunchRouter } from "../stage1/launchRoute.ts";
import { InMemoryAnalysisBindingRepository, type AnalysisBinding } from "../stage1/analysisBinding.ts";
import { decideLaunchOwnership } from "../stage1/launchOwnership.ts";
import { parseLaunchContext } from "../stage1/contracts.ts";
import { createShareGrantRouter } from "../stage4/shareGrantRoute.ts";
import { InMemoryShareGrantRepository } from "../stage4/shareGrantRepository.ts";
import { sqlAnalysisOwnership, noAnalysisOwnership } from "../stage4/analysisOwnership.ts";
import { InMemoryLinkRepository, SqlLinkRepository } from "../stage2/linkRepository.ts";
import { createLinkRouter } from "../stage2/linkRoute.ts";
import { InMemoryNonceStore } from "../service-auth/nonceStore.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";
import {
  applyShareGrantEvent,
  authorizeSharedRead,
  createShareGrant,
  projectSharedSummary,
  type CreateShareGrantInput,
  type ShareGrant,
} from "../domain/shareGrant.ts";
import {
  LINK_GRANTS,
  generateChallenge,
  hashChallenge,
  resolveLinkByEmail,
  type CrossProductLink,
} from "../domain/crossProductLink.ts";
import {
  contextPartitionKey,
  resolveOperatingContext,
  type ContextAuthorityRecord,
  type OperatingContextKind,
} from "../domain/operatingContext.ts";
import { authorize, KNOWN_SCOPES } from "../domain/policy.ts";
import {
  LIGHTHOUSE_FEATURE_FLAGS,
  envVarNameFor,
  featureFlagSnapshot,
  isFeatureEnabled,
} from "../config/featureFlags.ts";
import { createAuthorityLookup, isOperatingContextEnabled } from "../auth/contextWiring.ts";
import { createLighthouseSubsystem } from "../bootstrap.ts";
import type { SqlClient, TransactionalSqlClient } from "../persistence/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "persistence", "migrations");
const ENV_EXAMPLE = join(HERE, "..", "..", "..", ".env.example");

const NOW = new Date("2026-09-28T12:00:00.000Z");

const CLIENT = "actor-client-A";
const OTHER_CLIENT = "actor-client-B";
const PRO = "actor-professional-P";
const OTHER_PRO = "actor-professional-Q";
const ROS_PRO = "ros-person-P";
const ROS_OTHER = "ros-person-Q";
const REL = "rel-A-with-P";
const OTHER_REL = "rel-B-with-P";
const LINK = "link-A";

/** Every flag off — the only configuration this build may ship with. */
const ALL_OFF: Record<string, string> = Object.fromEntries(
  LIGHTHOUSE_FEATURE_FLAGS.map((f) => [envVarNameFor(f), "false"]),
);

function grantInput(overrides: Partial<CreateShareGrantInput> = {}): CreateShareGrantInput {
  return {
    shareGrantId: "grant-1",
    crossProductLinkId: LINK,
    linkIsActive: true,
    clientUserRef: CLIENT,
    authenticatedUserRef: CLIENT,
    destinationRelationshipRef: REL,
    recipientContext: "professional_assisted",
    recipientContextEnabled: true,
    selectedAnalysisIds: ["analysis-shared"],
    analysesOwnedByClient: true,
    selectedFields: ["grade", "primaryRisk"],
    purpose: "mortgage_review",
    expiresAt: null,
    noticeVersion: "share-notice-v1",
    consentAffirmed: true,
    now: NOW,
    correlationId: "corr-share-1",
    isEnabled: true,
    ...overrides,
  };
}

function mustGrant(overrides: Partial<CreateShareGrantInput> = {}): ShareGrant {
  const result = createShareGrant(grantInput(overrides));
  assert.equal(result.ok, true, `grant creation denied: ${!result.ok ? result.reason : ""}`);
  return (result as { ok: true; grant: ShareGrant }).grant;
}

function activeLink(overrides: Partial<CrossProductLink> = {}): CrossProductLink {
  return {
    crossProductLinkId: "link-P",
    relationshipOsPersonRef: ROS_PRO,
    investscapeUserRef: PRO,
    relationshipRef: "self",
    noticeVersion: "link-notice-v1",
    acceptedAt: NOW.toISOString(),
    correlationId: "corr-link-P",
    lifecycle: { state: "active", version: 1, occurredAt: NOW.toISOString(), appliedEventIds: [] },
    ...overrides,
  };
}

/** Creates and accepts a real invitation, returning the confirmed link. */
async function confirmLink(
  links: InMemoryLinkRepository,
  investscapeActorRef: string,
  relationshipOsPersonRef: string,
): Promise<CrossProductLink> {
  const challenge = generateChallenge();
  const invitationId = `inv-${investscapeActorRef}-${relationshipOsPersonRef}-${Math.random()}`;
  await links.createInvitation({
    invitationId, challengeHash: hashChallenge(challenge),
    relationshipOsPersonRef, relationshipRef: REL,
    expiresAt: "2026-09-28T12:15:00.000Z", noticeVersion: "link-notice-v1",
    correlationId: `corr-${invitationId}`, consumedAt: null,
  });
  const accepted = await links.accept({
    invitationId, presentedChallenge: challenge, investscapeActorRef,
    correlationId: `corr-${invitationId}`, now: NOW, isEnabled: true,
  });
  assert.ok(accepted.ok, "link acceptance failed");
  return accepted.link;
}

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

// ===========================================================================
// 1. Launch ownership (DEFECT-1)
// ===========================================================================

const LAUNCH_SESSION = "11111111-2222-3333-4444-555555555555";
const CODE = "c".repeat(48);

function launchContextV1(session = LAUNCH_SESSION) {
  return {
    schemaVersion: "investscape-launch-context.v1",
    launchSessionId: session,
    analysisType: "investment_quick_review",
    modules: ["property_overview"],
    permittedScopes: ["property.basic"],
    redactedScopes: [],
    expiresAt: "2026-09-28T12:05:00.000Z",
    context: { property: { propertyRef: "prop-opaque-1", propertyType: "detached" } },
    correlationId: "corr-launch-1",
  };
}

function launchContextV2(initiator: string, session = LAUNCH_SESSION) {
  return {
    ...launchContextV1(session),
    schemaVersion: "investscape-launch-context.v2",
    initiatingProfessional: { relationshipOsPersonRef: initiator },
  };
}

describe("DEFECT-1 launch ownership — login plus a launch link is not enough", () => {
  let server: Server;
  let baseUrl: string;
  let bindings: InMemoryAnalysisBindingRepository;
  let links: InMemoryLinkRepository;
  let audit: InMemoryAuditSink;
  let actor: string | null;
  let producerResponse: Record<string, unknown>;
  let redemptionCalls: number;
  let analysisCounter = 0;

  before(async () => {
    bindings = new InMemoryAnalysisBindingRepository();
    links = new InMemoryLinkRepository();
    audit = new InMemoryAuditSink();
    await confirmLink(links, PRO, ROS_PRO);
    await confirmLink(links, OTHER_PRO, ROS_OTHER);

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
          fetch: (async () => {
            redemptionCalls += 1;
            return new Response(JSON.stringify(producerResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }) as typeof fetch,
          now: () => Math.floor(NOW.getTime() / 1000),
          newOperationId: () => "op-1",
        },
        bindings,
        links,
        auditSink: audit,
        newAnalysisId: () => `analysis-launched-${++analysisCounter}`,
        now: () => NOW,
        env: { ...ALL_OFF, LIGHTHOUSE_FF_STAGE1_LAUNCH_RECEIVER: "true" },
      }),
    );
    ({ server, baseUrl } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function redeem(session: string): Promise<Response> {
    return fetch(`${baseUrl}/v1/lighthouse/launch/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchSessionId: session, code: CODE }),
    });
  }

  test("an unauthenticated browser gets 401 and the code is never sent to Relationship OS", async () => {
    actor = null;
    redemptionCalls = 0;
    producerResponse = launchContextV2(ROS_PRO, "11111111-2222-3333-4444-000000000001");
    const res = await redeem("11111111-2222-3333-4444-000000000001");
    assert.equal(res.status, 401);
    assert.equal(redemptionCalls, 0);
  });

  test("a signed-in user with no active link is refused BEFORE the code is consumed", async () => {
    actor = CLIENT;
    redemptionCalls = 0;
    producerResponse = launchContextV2(ROS_PRO, "11111111-2222-3333-4444-000000000002");
    const res = await redeem("11111111-2222-3333-4444-000000000002");
    assert.equal(res.status, 403);
    assert.equal(redemptionCalls, 0);
    assert.equal(await bindings.findByLaunchSession("11111111-2222-3333-4444-000000000002"), null);
  });

  test("a v1 launch (no named initiator) can never be bound to an owner", async () => {
    actor = PRO;
    producerResponse = launchContextV1("11111111-2222-3333-4444-000000000003");
    const res = await redeem("11111111-2222-3333-4444-000000000003");
    assert.equal(res.status, 403);
    assert.equal(await bindings.findByLaunchSession("11111111-2222-3333-4444-000000000003"), null);
    const denial = audit.events.find((e) => e.eventType === "stage1.redemption.ownership_denied");
    assert.equal(denial?.metadata?.reason, "INITIATOR_NOT_ASSERTED");
  });

  test("a linked professional holding ANOTHER professional's launch link is refused", async () => {
    // OTHER_PRO is signed in and linked — but to ROS_OTHER, not the initiator.
    actor = OTHER_PRO;
    producerResponse = launchContextV2(ROS_PRO, "11111111-2222-3333-4444-000000000004");
    const res = await redeem("11111111-2222-3333-4444-000000000004");
    assert.equal(res.status, 403);
    assert.equal(await bindings.findByLaunchSession("11111111-2222-3333-4444-000000000004"), null);
  });

  test("the confirmed-linked initiator gets a binding with owner, professional_assisted context, initiator and link", async () => {
    actor = PRO;
    producerResponse = launchContextV2(ROS_PRO);
    const res = await redeem(LAUNCH_SESSION);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.state, "success");
    assert.equal(body.operatingContext, "professional_assisted");

    const binding = await bindings.findByLaunchSession(LAUNCH_SESSION);
    assert.ok(binding);
    assert.equal(binding.professionalActorRef, PRO);
    assert.equal(binding.operatingContext, "professional_assisted");
    assert.equal(binding.initiatorPersonRef, ROS_PRO);
    const [proLink] = await links.findActiveLinksForActor(PRO);
    assert.equal(binding.crossProductLinkId, proLink!.crossProductLinkId);

    const succeeded = audit.events.find((e) => e.eventType === "stage1.redemption.succeeded");
    assert.equal(succeeded?.actorId, PRO);
    assert.equal(succeeded?.operatingContext, "professional_assisted");
  });

  test("no launch audit event is ever recorded as personal, and the code never appears", async () => {
    const launchEvents = audit.events.filter((e) => e.eventType.startsWith("stage1."));
    assert.ok(launchEvents.length > 0);
    for (const event of launchEvents) {
      assert.equal(event.operatingContext, "professional_assisted");
      assert.notEqual(event.authority.kind, "self");
    }
    assert.equal(JSON.stringify(audit.events).includes(CODE), false);
  });

  test("an existing binding cannot be adopted by a different actor", async () => {
    const session = "11111111-2222-3333-4444-000000000005";
    const foreign: AnalysisBinding = {
      launchSessionId: session, analysisId: "analysis-owned-by-Q", analysisType: "investment_quick_review",
      permittedModules: [], permittedScopes: [], redactedScopes: [], correlationId: "corr-q",
      propertyRef: "prop-q", createdAt: NOW.toISOString(),
      professionalActorRef: OTHER_PRO, operatingContext: "professional_assisted",
      initiatorPersonRef: ROS_PRO, crossProductLinkId: "link-q",
    };
    await bindings.createIfAbsent(foreign);
    actor = PRO;
    producerResponse = launchContextV2(ROS_PRO, session);
    const res = await redeem(session);
    assert.equal(res.status, 403);
    assert.equal((await bindings.findByLaunchSession(session))?.professionalActorRef, OTHER_PRO);
  });

  test("ownership decision: only an ACTIVE link from this actor to the initiator binds", () => {
    const v2 = parseLaunchContext(launchContextV2(ROS_PRO));
    assert.ok(v2.ok);
    assert.equal(decideLaunchOwnership(v2.value, PRO, [activeLink()]).ok, true);
    assert.deepEqual(
      decideLaunchOwnership(v2.value, PRO, [activeLink({ lifecycle: { ...activeLink().lifecycle, state: "revoked" } })]),
      { ok: false, reason: "INITIATOR_NOT_LINKED_TO_ACTOR" },
    );
    assert.deepEqual(
      decideLaunchOwnership(v2.value, PRO, [activeLink({ investscapeUserRef: OTHER_PRO })]),
      { ok: false, reason: "INITIATOR_NOT_LINKED_TO_ACTOR" },
    );
    assert.deepEqual(
      decideLaunchOwnership(v2.value, PRO, [activeLink({ relationshipOsPersonRef: ROS_OTHER })]),
      { ok: false, reason: "INITIATOR_NOT_LINKED_TO_ACTOR" },
    );
  });

  test("v2 schema is strict: the initiator is required and carries nothing else", () => {
    const missing = { ...launchContextV2(ROS_PRO) } as Record<string, unknown>;
    delete missing.initiatingProfessional;
    assert.equal(parseLaunchContext(missing).ok, false);
    assert.equal(
      parseLaunchContext({ ...launchContextV2(ROS_PRO), initiatingProfessional: { relationshipOsPersonRef: ROS_PRO, email: "p@example.com" } }).ok,
      false,
    );
  });
});

describe("P1 launch storage — launched analyses stay out of personal workspaces", () => {
  test("launch bindings live in the lighthouse schema, which browser roles cannot read", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0001_lighthouse_foundation.sql"), "utf8");
    assert.match(sql, /create table if not exists lighthouse\.launch_analysis_bindings/);
    assert.match(sql, /revoke all on lighthouse\.%I from anon, authenticated/);
    assert.match(sql, /revoke all on schema lighthouse from public/);
  });

  test("DEFECT-1 migration 0013 makes owner, context, initiator and link mandatory and pins the context", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0013_launch_binding_ownership.sql"), "utf8");
    for (const column of ["professional_actor_ref", "operating_context", "initiator_person_ref", "cross_product_link_id"]) {
      assert.match(sql, new RegExp(`add column if not exists ${column}\\s+text not null`));
    }
    assert.match(sql, /check \(operating_context = 'professional_assisted'\)/);
    assert.match(sql, /refusing to backfill/);
  });

  test("no personal-workspace table or WeWeb view reads launch bindings or share grants", () => {
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!/^00(08|09|10|11|12)_/.test(file)) continue;
      // Comments are stripped: prose that mentions "lighthouse.*" is not a query.
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(/--.*$/gm, "").toLowerCase();
      assert.equal(sql.includes("launch_analysis_bindings"), false, `${file} references launch bindings`);
      assert.equal(sql.includes("share_grants"), false, `${file} references share grants`);
      assert.equal(/\blighthouse\./.test(sql), false, `${file} reaches into the lighthouse schema`);
    }
  });
});

describe("P1 context resolution — the browser can ask, only an authority row grants", () => {
  const selfRecord: ContextAuthorityRecord = {
    kind: "personal", actorId: PRO, subjectId: PRO,
    authority: { kind: "self" }, scopes: ["portfolio.read"], status: "active",
  };
  const launchRecord: ContextAuthorityRecord = {
    kind: "professional_assisted", actorId: PRO, subjectId: CLIENT,
    authority: { kind: "sponsored_entitlement", grantId: "launch-1" },
    scopes: ["property.basic"], status: "active", relationshipRef: REL,
  };

  function resolve(
    kind: string,
    records: readonly ContextAuthorityRecord[],
    opts: { actor?: string; rel?: string; enabled?: (k: OperatingContextKind) => boolean } = {},
  ) {
    return resolveOperatingContext({
      authenticatedActorId: opts.actor ?? PRO,
      requestedKind: kind,
      requestedRelationshipRef: opts.rel,
      lookupAuthority: async (actorId, k, rel) =>
        records.find(
          (r) => r.actorId === actorId && r.kind === k && (rel === undefined || r.relationshipRef === rel),
        ) ?? null,
      isContextEnabled: opts.enabled ?? (() => true),
      now: () => NOW,
      correlationId: "corr-ctx",
    });
  }

  test("a professional's personal and relationship-scoped contexts never share a partition", async () => {
    const personal = await resolve("personal", [selfRecord, launchRecord]);
    const assisted = await resolve("professional_assisted", [selfRecord, launchRecord]);
    assert.ok(personal.ok && assisted.ok);
    assert.notEqual(contextPartitionKey(personal.context), contextPartitionKey(assisted.context));
    assert.equal(personal.context.subjectId, PRO);
    assert.equal(assisted.context.subjectId, CLIENT);
  });

  test("personal context whose subject is someone else is refused", async () => {
    const forged: ContextAuthorityRecord = { ...launchRecord, kind: "personal" };
    assert.deepEqual(await resolve("personal", [forged]), { ok: false, reason: "SUBJECT_MISMATCH" });
  });

  test("requesting professional_assisted without an authority row is refused", async () => {
    assert.deepEqual(await resolve("professional_assisted", [selfRecord]), { ok: false, reason: "NO_AUTHORITY" });
  });

  test("a different user cannot resolve the professional's assisted context", async () => {
    assert.deepEqual(
      await resolve("professional_assisted", [launchRecord], { actor: OTHER_CLIENT }),
      { ok: false, reason: "NO_AUTHORITY" },
    );
  });

  test("revoked and expired authorities are refused", async () => {
    assert.deepEqual(
      await resolve("professional_assisted", [{ ...launchRecord, status: "revoked" }]),
      { ok: false, reason: "AUTHORITY_NOT_ACTIVE" },
    );
    assert.deepEqual(
      await resolve("professional_assisted", [{ ...launchRecord, expiresAt: "2026-09-28T11:59:59.000Z" }]),
      { ok: false, reason: "AUTHORITY_EXPIRED" },
    );
  });

  test("unknown and organization contexts fail closed", async () => {
    assert.deepEqual(await resolve("admin", [selfRecord]), { ok: false, reason: "UNKNOWN_CONTEXT" });
    assert.deepEqual(await resolve("organization", [selfRecord]), { ok: false, reason: "CONTEXT_DISABLED" });
  });
});

// ===========================================================================
// 2. Delegation stays disabled; production context wiring (DEFECT-6)
// ===========================================================================

describe("P1 delegation disabled and DEFECT-6 production context wiring", () => {
  const mandate: ContextAuthorityRecord = {
    kind: "delegated_client", actorId: PRO, subjectId: CLIENT,
    authority: { kind: "delegation_mandate", grantId: "mandate-1" },
    scopes: ["portfolio.read"], status: "active", relationshipRef: REL,
  };

  test("the shipped .env.example leaves every lighthouse flag off", () => {
    const text = readFileSync(ENV_EXAMPLE, "utf8");
    for (const flag of LIGHTHOUSE_FEATURE_FLAGS) {
      const match = text.match(new RegExp(`^${envVarNameFor(flag)}=(.*)$`, "m"));
      assert.ok(match, `${envVarNameFor(flag)} missing from .env.example`);
      assert.equal(match[1]!.trim(), "false", `${envVarNameFor(flag)} is not false`);
    }
    const parsed = Object.fromEntries(
      [...text.matchAll(/^(LIGHTHOUSE_FF_[A-Z_]+)=(.*)$/gm)].map((m) => [m[1], m[2]]),
    );
    assert.ok(Object.values(featureFlagSnapshot(parsed)).every((v) => v === false));
  });

  test("DEFECT-6 production maps each context kind to its flag; with flags off only personal resolves", () => {
    assert.equal(isOperatingContextEnabled("personal", ALL_OFF), true);
    assert.equal(isOperatingContextEnabled("professional_assisted", ALL_OFF), false);
    assert.equal(isOperatingContextEnabled("delegated_client", ALL_OFF), false);
    assert.equal(isOperatingContextEnabled("organization", ALL_OFF), false);
    const everythingOn = Object.fromEntries(Object.keys(ALL_OFF).map((k) => [k, "true"]));
    assert.equal(isOperatingContextEnabled("delegated_client", everythingOn), true);
    assert.equal(isOperatingContextEnabled("organization", everythingOn), false);
  });

  test("DEFECT-6 authority lookup: personal is the caller's own self-authority; others need a row", async () => {
    const lookup = createAuthorityLookup(null);
    assert.deepEqual(await lookup(PRO, "personal"), {
      kind: "personal", actorId: PRO, subjectId: PRO, authority: { kind: "self" }, scopes: [], status: "active",
    });
    assert.equal(await lookup(PRO, "professional_assisted", REL), null);
    assert.equal(await lookup(PRO, "delegated_client", REL), null);
  });

  test("an active mandate still cannot resolve delegated_client while the flag is off (production mapping)", async () => {
    const result = await resolveOperatingContext({
      authenticatedActorId: PRO,
      requestedKind: "delegated_client",
      requestedRelationshipRef: REL,
      lookupAuthority: async () => mandate,
      isContextEnabled: (k) => isOperatingContextEnabled(k, ALL_OFF),
      now: () => NOW,
      correlationId: "corr-del",
    });
    assert.deepEqual(result, { ok: false, reason: "FEATURE_DISABLED" });
  });

  test("policy denies delegated operations with the flag off, even with a resolved mandate context", async () => {
    const decision = await authorize(
      {
        featureFlag: "lighthouse.delegated_portfolio_management",
        context: {
          kind: "delegated_client", actorId: PRO, subjectId: CLIENT,
          authority: mandate.authority, scopes: mandate.scopes,
          relationshipRef: REL, correlationId: "corr-del",
        },
        requiredScopes: ["portfolio.read"],
        requiredAuthority: "delegation_mandate",
        permittedContexts: ["delegated_client"],
      },
      { isFeatureEnabled: (f) => isFeatureEnabled(f, ALL_OFF), knownScopes: KNOWN_SCOPES },
    );
    assert.deepEqual(decision, { allowed: false, reason: "FEATURE_FLAG_DISABLED" });
  });
});

describe("DEFECT-6 real bootstrap wiring (in-memory persistence, dev sessions, injected env)", () => {
  let server: Server;
  let baseUrl: string;
  let shutdown: () => Promise<void>;

  before(async () => {
    const subsystem = createLighthouseSubsystem({
      ...ALL_OFF,
      NODE_ENV: "test",
      LIGHTHOUSE_ALLOW_INMEMORY_PERSISTENCE: "true",
      LIGHTHOUSE_ALLOW_DEV_SESSIONS: "true",
      // Sharing and the launch receiver on for THIS in-process app only.
      LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING: "true",
      LIGHTHOUSE_FF_STAGE1_LAUNCH_RECEIVER: "true",
    } as NodeJS.ProcessEnv);
    assert.equal(subsystem.status.available, true);
    shutdown = subsystem.shutdown;
    const app = express();
    app.use(express.json());
    app.use("/v1/lighthouse", subsystem.router);
    ({ server, baseUrl } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await shutdown();
  });

  const as = (actorRef: string, context?: string, rel?: string): Record<string, string> => ({
    authorization: `Bearer dev:${actorRef}`,
    ...(context ? { "x-operating-context": context } : {}),
    ...(rel ? { "x-relationship-ref": rel } : {}),
  });

  test("a client acting for themselves (personal) may list their shares", async () => {
    const res = await fetch(`${baseUrl}/v1/lighthouse/shares`, { headers: as(CLIENT) });
    assert.equal(res.status, 200);
  });

  test("share routes refuse professional_assisted and delegated_client contexts", async () => {
    for (const [context, rel] of [["professional_assisted", REL], ["delegated_client", REL], ["organization", undefined]] as const) {
      const res = await fetch(`${baseUrl}/v1/lighthouse/shares`, { headers: as(PRO, context, rel) });
      assert.equal(res.status, 403, `${context} was not refused`);
    }
  });

  test("an unauthenticated caller is refused before any context work", async () => {
    assert.equal((await fetch(`${baseUrl}/v1/lighthouse/shares`)).status, 401);
    const redeem = await fetch(`${baseUrl}/v1/lighthouse/launch/redeem`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchSessionId: LAUNCH_SESSION, code: CODE }),
    });
    assert.equal(redeem.status, 401);
  });

  test("in-memory mode cannot prove analysis ownership, so every share is refused", async () => {
    const res = await fetch(`${baseUrl}/v1/lighthouse/shares`, {
      method: "POST",
      headers: { ...as(CLIENT), "content-type": "application/json" },
      body: JSON.stringify({
        crossProductLinkId: LINK, clientUserRef: CLIENT, destinationRelationshipRef: REL,
        recipientContext: "professional_assisted", selectedAnalysisIds: ["analysis-shared"],
        selectedFields: ["grade"], purpose: "mortgage_review", expiresAt: null,
        noticeVersion: "share-notice-v1", consentAffirmed: true,
      }),
    });
    assert.equal(res.status, 403);
  });

  test("with every flag off, the same routes answer 503 even for a signed-in user", async () => {
    const off = createLighthouseSubsystem({
      ...ALL_OFF, NODE_ENV: "test",
      LIGHTHOUSE_ALLOW_INMEMORY_PERSISTENCE: "true", LIGHTHOUSE_ALLOW_DEV_SESSIONS: "true",
    } as NodeJS.ProcessEnv);
    const app = express();
    app.use(express.json());
    app.use("/v1/lighthouse", off.router);
    const { server: s, baseUrl: url } = await listen(app);
    try {
      assert.equal((await fetch(`${url}/v1/lighthouse/shares`, { headers: as(CLIENT) })).status, 503);
      const redeem = await fetch(`${url}/v1/lighthouse/launch/redeem`, {
        method: "POST", headers: { ...as(PRO), "content-type": "application/json" },
        body: JSON.stringify({ launchSessionId: LAUNCH_SESSION, code: CODE }),
      });
      assert.equal(redeem.status, 503);
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
      await off.shutdown();
    }
  });
});

// ===========================================================================
// 3. Linking grants nothing; unlink revokes atomically (DEFECT-3)
// ===========================================================================

describe("P1 linking alone grants no sharing permission", () => {
  test("a confirmed link carries no grants and email is never identity", () => {
    assert.deepEqual(LINK_GRANTS, []);
    assert.deepEqual(resolveLinkByEmail("client@example.com"), { ok: false, reason: "EMAIL_IS_NOT_IDENTITY" });
  });

  test("an active, confirmed link exposes zero analyses to the linked relationship", async () => {
    const grants = new InMemoryShareGrantRepository();
    const links = new InMemoryLinkRepository({ shareGrants: grants });
    await confirmLink(links, CLIENT, "ros-person-A");
    assert.deepEqual(await grants.findActiveGrantsForRelationship(REL, "professional_assisted", NOW), []);
    assert.deepEqual(await grants.findActiveGrantsForClient(CLIENT), []);
  });

  test("sharing is refused without an active link, without consent, or with the feature off", () => {
    assert.deepEqual(createShareGrant(grantInput({ linkIsActive: false })), { ok: false, reason: "LINK_NOT_ACTIVE" });
    assert.deepEqual(createShareGrant(grantInput({ consentAffirmed: false })), { ok: false, reason: "CONSENT_NOT_AFFIRMED" });
    assert.deepEqual(createShareGrant(grantInput({ isEnabled: false })), { ok: false, reason: "FEATURE_DISABLED" });
  });

  test("DEFECT-3 unlinking revokes every share grant riding on that link, and only those", async () => {
    const grants = new InMemoryShareGrantRepository();
    const links = new InMemoryLinkRepository({ shareGrants: grants });
    const link = await confirmLink(links, CLIENT, "ros-person-A2");
    await grants.create(grantInput({ shareGrantId: "g-on-link", crossProductLinkId: link.crossProductLinkId }));
    await grants.create(grantInput({ shareGrantId: "g-other-link", crossProductLinkId: "some-other-link", destinationRelationshipRef: OTHER_REL }));

    const revocation = await links.revokeLink(link.crossProductLinkId, CLIENT, NOW, link.lifecycle.version);
    assert.ok(revocation);
    assert.deepEqual(revocation.revokedShareGrantIds, ["g-on-link"]);
    assert.equal((await grants.findById("g-on-link"))?.lifecycle.state, "revoked");
    assert.equal((await grants.findById("g-other-link"))?.lifecycle.state, "active");
    assert.deepEqual(await grants.findActiveGrantsForRelationship(REL, "professional_assisted", NOW), []);
  });

  test("DEFECT-3 another user cannot unlink (and so cannot revoke) the client's link and grants", async () => {
    const grants = new InMemoryShareGrantRepository();
    const links = new InMemoryLinkRepository({ shareGrants: grants });
    const link = await confirmLink(links, CLIENT, "ros-person-A3");
    await grants.create(grantInput({ crossProductLinkId: link.crossProductLinkId }));
    assert.equal(await links.revokeLink(link.crossProductLinkId, PRO, NOW, link.lifecycle.version), null);
    assert.equal((await grants.findById("grant-1"))?.lifecycle.state, "active");
  });

  test("DEFECT-3 the unlink route reports how many grants it revoked", async () => {
    const grants = new InMemoryShareGrantRepository();
    const links = new InMemoryLinkRepository({ shareGrants: grants });
    const link = await confirmLink(links, CLIENT, "ros-person-A4");
    await grants.create(grantInput({ crossProductLinkId: link.crossProductLinkId }));

    const app = express();
    app.use(express.json());
    app.use(
      "/v1/lighthouse",
      (req, _res, next) => { req.lighthouseSession = { actorRef: CLIENT } as never; next(); },
      createLinkRouter({
        links, auditSink: new InMemoryAuditSink(), nonces: new InMemoryNonceStore(),
        inboundSecrets: {}, now: () => NOW, newInvitationId: () => "unused",
        env: { ...ALL_OFF, LIGHTHOUSE_FF_CROSS_PRODUCT_IDENTITY_LINKING: "true" },
      }),
    );
    const { server, baseUrl } = await listen(app);
    try {
      const res = await fetch(`${baseUrl}/v1/lighthouse/link/${link.crossProductLinkId}/unlink`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: link.lifecycle.version }),
      });
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { sharesRevoked: number }).sharesRevoked, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("DEFECT-3 the SQL unlink revokes link and grants inside ONE transaction", async () => {
    const outside: string[] = [];
    const inside: string[] = [];
    let transactions = 0;
    const tx: SqlClient = {
      async query(sql: string) {
        inside.push(sql.replace(/\s+/g, " ").trim());
        if (sql.includes("update lighthouse.cross_product_links")) {
          return { rows: [{ correlation_id: "corr-x" }], rowCount: 1 } as never;
        }
        return { rows: [{ share_grant_id: "g-1" }, { share_grant_id: "g-2" }], rowCount: 2 } as never;
      },
    } as SqlClient;
    const client = {
      async query(sql: string) { outside.push(sql); return { rows: [], rowCount: 0 }; },
      async transaction<T>(fn: (c: SqlClient) => Promise<T>) { transactions += 1; return fn(tx); },
    } as unknown as TransactionalSqlClient;

    const revocation = await new SqlLinkRepository(client).revokeLink("link-x", CLIENT, NOW, 1);
    assert.equal(transactions, 1);
    assert.deepEqual(outside, []);
    assert.equal(inside.length, 2);
    assert.match(inside[0]!, /^update lighthouse\.cross_product_links/);
    assert.match(inside[1]!, /^update lighthouse\.share_grants set state = 'revoked'/);
    assert.match(inside[1]!, /state = 'active'/);
    assert.deepEqual(revocation?.revokedShareGrantIds, ["g-1", "g-2"]);
  });

  test("a revoked grant can never be reactivated; re-sharing needs a new grant", () => {
    const grant = mustGrant();
    const revoked: ShareGrant = { ...grant, lifecycle: { ...grant.lifecycle, state: "revoked", version: 2 } };
    const outcome = applyShareGrantEvent(revoked, {
      eventId: "evt-reactivate", targetState: "active", version: 3, occurredAt: NOW.toISOString(),
    } as Parameters<typeof applyShareGrantEvent>[1]);
    assert.notEqual(outcome.kind, "applied");
    assert.equal(outcome.snapshot.state, "revoked");
  });
});

// ===========================================================================
// 4. Shared reads: wrong user / relationship / recipient, revoked, expired
// ===========================================================================

describe("P1 shared-read authorization", () => {
  const read = {
    externalAnalysisId: "analysis-shared",
    relationshipRef: REL,
    recipientContext: "professional_assisted",
    linkIsActive: true,
  };

  test("the addressed relationship and recipient may read the selected analysis", () => {
    assert.deepEqual(authorizeSharedRead(mustGrant(), read, NOW), { ok: true });
  });

  test("DEFECT-3 every shared read re-checks the link: an inactive link discloses nothing", () => {
    assert.deepEqual(
      authorizeSharedRead(mustGrant(), { ...read, linkIsActive: false }, NOW),
      { ok: false, reason: "LINK_NOT_ACTIVE" },
    );
  });

  test("wrong relationship is refused even when the analysis id matches", () => {
    assert.deepEqual(
      authorizeSharedRead(mustGrant(), { ...read, relationshipRef: OTHER_REL }, NOW),
      { ok: false, reason: "WRONG_RELATIONSHIP" },
    );
  });

  test("wrong recipient context is refused", () => {
    assert.deepEqual(
      authorizeSharedRead(mustGrant(), { ...read, recipientContext: "delegated_client" }, NOW),
      { ok: false, reason: "WRONG_RECIPIENT_CONTEXT" },
    );
  });

  test("an unshared analysis of the same client is refused", () => {
    assert.deepEqual(
      authorizeSharedRead(mustGrant(), { ...read, externalAnalysisId: "analysis-unshared" }, NOW),
      { ok: false, reason: "NOT_SHARED" },
    );
  });

  test("revoked, expired, and not-yet-effective grants are refused", () => {
    const base = mustGrant({ expiresAt: "2026-09-29T12:00:00.000Z" });
    const revoked: ShareGrant = { ...base, lifecycle: { ...base.lifecycle, state: "revoked", version: 2 } };
    assert.equal(authorizeSharedRead(revoked, read, NOW).ok, false);
    assert.equal(authorizeSharedRead(base, read, new Date("2026-09-29T12:00:00.000Z")).ok, false);
    assert.equal(authorizeSharedRead(base, read, new Date("2026-09-28T11:00:00.000Z")).ok, false);
  });

  test("the shared projection carries only selected fields — never raw financial inputs", () => {
    const projected = projectSharedSummary(mustGrant(), {
      grade: "B+", primaryRisk: "rate reset", primaryOpportunity: "not selected",
      purchasePrice: "1250000", income: "180000", worksheet: "{...}", billingPlan: "pro",
    });
    assert.deepEqual(projected, { grade: "B+", primaryRisk: "rate reset" });
  });

  test("another user cannot revoke the client's grant", async () => {
    const grants = new InMemoryShareGrantRepository();
    await grants.create(grantInput());
    assert.equal(await grants.revoke("grant-1", PRO, 1, NOW), null);
    assert.equal(await grants.revoke("grant-1", OTHER_CLIENT, 1, NOW), null);
    assert.equal((await grants.findById("grant-1"))?.lifecycle.state, "active");
  });

  test("the relationship query returns only grants addressed to that relationship and recipient", async () => {
    const grants = new InMemoryShareGrantRepository();
    await grants.create(grantInput({ shareGrantId: "g-rel", selectedAnalysisIds: ["analysis-shared"] }));
    await grants.create(grantInput({ shareGrantId: "g-other", destinationRelationshipRef: OTHER_REL, selectedAnalysisIds: ["analysis-other-rel"] }));
    await grants.create(grantInput({
      shareGrantId: "g-b", clientUserRef: OTHER_CLIENT, authenticatedUserRef: OTHER_CLIENT,
      destinationRelationshipRef: OTHER_REL, selectedAnalysisIds: ["analysis-client-B"],
    }));

    const visible = await grants.findActiveGrantsForRelationship(REL, "professional_assisted", NOW);
    assert.deepEqual(visible.map((g) => g.shareGrantId), ["g-rel"]);
    assert.deepEqual(visible.flatMap((g) => g.selectedAnalysisIds), ["analysis-shared"]);
    assert.deepEqual(await grants.findActiveGrantsForRelationship(REL, "delegated_client", NOW), []);
  });

  test("DEFECT-2 the relationship query excludes grants past expiry, even before any sweep flips their state", async () => {
    const grants = new InMemoryShareGrantRepository();
    await grants.create(grantInput({ expiresAt: "2026-09-28T13:00:00.000Z" }));
    assert.equal((await grants.findActiveGrantsForRelationship(REL, "professional_assisted", NOW)).length, 1);
    assert.deepEqual(
      await grants.findActiveGrantsForRelationship(REL, "professional_assisted", new Date("2026-09-28T13:00:00.000Z")),
      [],
    );
    assert.equal((await grants.findById("grant-1"))?.lifecycle.state, "active", "state untouched: filter is by time");
  });

  test("DEFECT-2 the relationship query excludes grants not yet effective", async () => {
    const grants = new InMemoryShareGrantRepository();
    await grants.create(grantInput());
    assert.deepEqual(
      await grants.findActiveGrantsForRelationship(REL, "professional_assisted", new Date("2026-09-28T11:59:59.000Z")),
      [],
    );
  });

  test("DEFECT-2 the SQL relationship query filters on the effective window at the supplied instant", async () => {
    let captured: { sql: string; params: readonly unknown[] } | null = null;
    const client = {
      async query(sql: string, params: readonly unknown[]) { captured = { sql, params }; return { rows: [], rowCount: 0 }; },
      async transaction() { throw new Error("unused"); },
    } as unknown as TransactionalSqlClient;
    const { SqlShareGrantRepository } = await import("../stage4/shareGrantRepository.ts");
    await new SqlShareGrantRepository(client).findActiveGrantsForRelationship(REL, "professional_assisted", NOW);
    assert.ok(captured);
    const { sql, params } = captured as { sql: string; params: readonly unknown[] };
    assert.match(sql, /effective_from <= \$3/);
    assert.match(sql, /expires_at is null or expires_at > \$3/);
    assert.deepEqual(params, [REL, "professional_assisted", NOW.toISOString()]);
  });
});

// ===========================================================================
// 5. HTTP: no enumeration, no impersonation, ownership, recipient types
// ===========================================================================

describe("P1 share routes — no enumeration, no impersonation", () => {
  let server: Server;
  let baseUrl: string;
  let grants: InMemoryShareGrantRepository;
  let actor: string | null;
  let counter = 0;
  /** client -> analyses they own in their personal workspace */
  const owned: Record<string, readonly string[]> = {
    [CLIENT]: ["analysis-shared", "analysis-unshared"],
    [OTHER_CLIENT]: ["analysis-owned-by-client-B"],
  };
  const env: Record<string, string> = { ...ALL_OFF, LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING: "true" };

  before(async () => {
    grants = new InMemoryShareGrantRepository();
    actor = CLIENT;
    const app = express();
    app.use(express.json());
    app.use(
      "/v1/lighthouse",
      (req, _res, next) => {
        if (actor) req.lighthouseSession = { actorRef: actor } as never;
        next();
      },
      createShareGrantRouter({
        grants,
        auditSink: new InMemoryAuditSink(),
        isLinkActive: async (linkId, client) => linkId === LINK && client === CLIENT,
        ownsAllAnalyses: async (client, ids) => ids.every((id) => (owned[client] ?? []).includes(id)),
        now: () => NOW,
        newShareGrantId: () => `http-grant-${++counter}`,
        env,
      }),
    );
    ({ server, baseUrl } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function body(overrides: Record<string, unknown> = {}) {
    return {
      crossProductLinkId: LINK, clientUserRef: CLIENT, destinationRelationshipRef: REL,
      recipientContext: "professional_assisted", selectedAnalysisIds: ["analysis-shared"],
      selectedFields: ["grade"], purpose: "mortgage_review", expiresAt: null,
      noticeVersion: "share-notice-v1", consentAffirmed: true, ...overrides,
    };
  }
  const post = (b: unknown) =>
    fetch(`${baseUrl}/v1/lighthouse/shares`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
    });

  test("a client can share one of their own analyses to their own relationship", async () => {
    actor = CLIENT;
    assert.equal((await post(body())).status, 201);
  });

  test("DEFECT-4 a client cannot share an analysis they do not own", async () => {
    actor = CLIENT;
    const before = (await grants.findActiveGrantsForClient(CLIENT)).length;
    const res = await post(body({ selectedAnalysisIds: ["analysis-owned-by-client-B"] }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { state: "denied" }, "opaque: must not reveal whether the id exists");
    assert.equal((await grants.findActiveGrantsForClient(CLIENT)).length, before);
  });

  test("DEFECT-4 one foreign id poisons the whole selection", async () => {
    actor = CLIENT;
    const res = await post(body({ selectedAnalysisIds: ["analysis-shared", "analysis-owned-by-client-B"] }));
    assert.equal(res.status, 403);
  });

  test("DEFECT-5 an unknown recipient type is refused", async () => {
    actor = CLIENT;
    const res = await post(body({ recipientContext: "anyone-at-all" }));
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { reason: string }).reason, "UNKNOWN_RECIPIENT_CONTEXT");
  });

  test("DEFECT-5 delegated_client is refused as a recipient while delegation is disabled", async () => {
    actor = CLIENT;
    const res = await post(body({ recipientContext: "delegated_client" }));
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { reason: string }).reason, "RECIPIENT_CONTEXT_DISABLED");
  });

  test("a professional cannot create a grant over a client's analyses", async () => {
    actor = PRO;
    const before = (await grants.findActiveGrantsForClient(CLIENT)).length;
    assert.equal((await post(body())).status, 403);
    assert.equal((await grants.findActiveGrantsForClient(CLIENT)).length, before);
  });

  test("a professional listing /shares sees nothing of any client's grants", async () => {
    actor = PRO;
    const res = await fetch(`${baseUrl}/v1/lighthouse/shares`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes("analysis-shared"), false);
    assert.equal(text.includes(CLIENT), false);
  });

  test("an unauthenticated caller can neither list nor create", async () => {
    actor = null;
    assert.equal((await fetch(`${baseUrl}/v1/lighthouse/shares`)).status, 401);
    assert.equal((await post(body())).status, 401);
  });

  test("a client cannot ride another client's link", async () => {
    actor = OTHER_CLIENT;
    const res = await post(body({ clientUserRef: OTHER_CLIENT, selectedAnalysisIds: ["analysis-owned-by-client-B"] }));
    assert.equal(res.status, 403);
  });

  test("with the sharing flag off, every share route answers 503", async () => {
    actor = CLIENT;
    env.LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING = "false";
    try {
      assert.equal((await post(body())).status, 503);
      assert.equal((await fetch(`${baseUrl}/v1/lighthouse/shares`)).status, 503);
    } finally {
      env.LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING = "true";
    }
  });
});

describe("DEFECT-4 SQL analysis ownership", () => {
  const A = "aaaaaaaa-0000-4000-8000-000000000001";
  const D1 = "dddddddd-0000-4000-8000-000000000001";
  const D2 = "dddddddd-0000-4000-8000-000000000002";

  function fakeClient(owned: number) {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const client = {
      async query(sql: string, params: readonly unknown[]) {
        calls.push({ sql, params });
        return { rows: [{ owned: String(owned) }], rowCount: 1 };
      },
    } as unknown as SqlClient;
    return { client, calls };
  }

  test("queries the caller's own, non-deleted personal-workspace deals only", async () => {
    const { client, calls } = fakeClient(2);
    assert.equal(await sqlAnalysisOwnership(client)(A, [D1, D2, D1]), true);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.sql, /from investscape\.deals/);
    assert.match(calls[0]!.sql, /owner_id = \$1::uuid/);
    assert.match(calls[0]!.sql, /deleted_at is null/);
    assert.equal(/launch_analysis_bindings/.test(calls[0]!.sql), false, "launched analyses are never the client's");
    assert.deepEqual(calls[0]!.params, [A, [D1, D2]]);
  });

  test("fewer owned rows than distinct ids is not owned", async () => {
    const { client } = fakeClient(1);
    assert.equal(await sqlAnalysisOwnership(client)(A, [D1, D2]), false);
  });

  test("non-UUID ids, a non-UUID actor, or an empty list fail closed without querying", async () => {
    const { client, calls } = fakeClient(99);
    const check = sqlAnalysisOwnership(client);
    assert.equal(await check(A, ["not-a-uuid"]), false);
    assert.equal(await check("dev-actor", [D1]), false);
    assert.equal(await check(A, []), false);
    assert.equal(calls.length, 0);
  });

  test("in-memory mode proves nothing and refuses", async () => {
    assert.equal(await noAnalysisOwnership(A, [D1]), false);
  });
});
