/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * The SQL repositories, exercised against REAL Postgres.
 *
 * These implementations were written against a schema that had never been
 * executed. Until this file ran, "SqlNonceStore prevents replay" was an
 * assertion about code nobody had connected to a database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import { createPgClientFromEnv } from "./pgClient.ts";
import {
  buildRepositories,
  buildRepositoriesFromEnv,
  PersistenceNotConfiguredError,
} from "./repositories.ts";
import { generateNonce } from "../service-auth/hmac.ts";
import { generateChallenge, hashChallenge } from "../domain/crossProductLink.ts";

dotenv.config();

const client = createPgClientFromEnv();
const skip = client === null ? "DATABASE_URL not set" : false;
const RUN = `r${Date.now().toString(36)}`;

const repos = client
  ? buildRepositories({ client, allowInMemory: false, isProduction: false })
  : null;

// ---------------------------------------------------------------------------
// Composition root — fail-closed behaviour
// ---------------------------------------------------------------------------

test("a live client yields postgres-backed repositories", { skip }, () => {
  assert.equal(repos!.mode, "postgres");
  assert.notEqual(repos!.sql, null);
});

test("no database and no opt-in refuses to start", () => {
  assert.throws(
    () => buildRepositories({ client: null, allowInMemory: false, isProduction: false }),
    PersistenceNotConfiguredError,
  );
});

test("production refuses in-memory persistence even when the flag is set", () => {
  // The flag is an explicit local-development escape hatch. It must not be a
  // way to boot production without a database.
  assert.throws(
    () => buildRepositories({ client: null, allowInMemory: true, isProduction: true }),
    /Refusing to start/,
  );
});

test("local development can opt in explicitly", () => {
  const built = buildRepositories({ client: null, allowInMemory: true, isProduction: false });
  assert.equal(built.mode, "in-memory");
  assert.equal(built.sql, null);
});

test("only the exact string 'true' opts in to in-memory persistence", () => {
  for (const value of ["1", "yes", "on", "TRUE", "True", ""]) {
    assert.throws(
      () => buildRepositoriesFromEnv(null, { LIGHTHOUSE_ALLOW_INMEMORY_PERSISTENCE: value } as NodeJS.ProcessEnv),
      PersistenceNotConfiguredError,
      `"${value}" must not enable in-memory persistence`,
    );
  }
  assert.equal(
    buildRepositoriesFromEnv(null, { LIGHTHOUSE_ALLOW_INMEMORY_PERSISTENCE: "true" } as NodeJS.ProcessEnv).mode,
    "in-memory",
  );
});

// ---------------------------------------------------------------------------
// SqlNonceStore — replay protection against a real unique index
// ---------------------------------------------------------------------------

test("a nonce is consumable exactly once", { skip }, async () => {
  const nonce = generateNonce();
  const now = Math.floor(Date.now() / 1000);

  const first = await repos!.nonces.consume("investscape", `${RUN}-key`, nonce, now);
  const second = await repos!.nonces.consume("investscape", `${RUN}-key`, nonce, now);

  assert.equal(first, true, "first use must be accepted");
  assert.equal(second, false, "replay must be rejected by the unique index");
});

test("the same nonce under a different key id is independent", { skip }, async () => {
  const nonce = generateNonce();
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await repos!.nonces.consume("investscape", `${RUN}-k1`, nonce, now), true);
  assert.equal(await repos!.nonces.consume("investscape", `${RUN}-k2`, nonce, now), true);
});

test("the raw nonce is never stored — only its hash", { skip }, async () => {
  const nonce = generateNonce();
  await repos!.nonces.consume("investscape", `${RUN}-hash`, nonce, Math.floor(Date.now() / 1000));

  const found = await client!.query(
    "select 1 from lighthouse.service_request_nonces where nonce_hash = $1",
    [nonce],
  );
  assert.equal(found.rows.length, 0, "the plaintext nonce must not appear in the table");

  const byKey = await client!.query<{ nonce_hash: string }>(
    "select nonce_hash from lighthouse.service_request_nonces where key_id = $1",
    [`${RUN}-hash`],
  );
  assert.equal(byKey.rows.length, 1);
  assert.match(byKey.rows[0]!.nonce_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(byKey.rows[0]!.nonce_hash, nonce);
});

// ---------------------------------------------------------------------------
// SqlAnalysisBindingRepository
// ---------------------------------------------------------------------------

function binding(sessionId: string, analysisId: string) {
  return {
    launchSessionId: sessionId,
    analysisId,
    analysisType: "investment_quick_review",
    permittedModules: ["property_overview"] as const,
    permittedScopes: ["property.basic"],
    redactedScopes: ["finance.raw"],
    correlationId: `${RUN}-corr`,
    propertyRef: "a".repeat(64),
    createdAt: new Date().toISOString(),
    professionalActorRef: `${RUN}-actor-pro`,
    operatingContext: "professional_assisted" as const,
    initiatorPersonRef: `${RUN}-ros-person`,
    crossProductLinkId: `${RUN}-link`,
  };
}

function newSessionId(): string {
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

test("a binding round-trips through Postgres with arrays intact", { skip }, async () => {
  const session = newSessionId();
  const created = await repos!.bindings.createIfAbsent(binding(session, `${RUN}-an-1`));
  assert.equal(created.created, true);

  const found = await repos!.bindings.findByLaunchSession(session);
  assert.notEqual(found, null);
  assert.equal(found!.analysisId, `${RUN}-an-1`);
  // text[] must survive the driver round-trip as a real array, not a string.
  assert.deepEqual([...found!.permittedScopes], ["property.basic"]);
  assert.deepEqual([...found!.redactedScopes], ["finance.raw"]);
  assert.deepEqual([...found!.permittedModules], ["property_overview"]);
});

test("concurrent landing requests converge on exactly one analysis", { skip }, async () => {
  const session = newSessionId();

  // Fire both at once against the real unique index — this is the actual race,
  // not a simulated one.
  const [a, b] = await Promise.all([
    repos!.bindings.createIfAbsent(binding(session, `${RUN}-race-a`)),
    repos!.bindings.createIfAbsent(binding(session, `${RUN}-race-b`)),
  ]);

  const createdCount = [a, b].filter((r) => r.created).length;
  assert.equal(createdCount, 1, "exactly one request may create the binding");
  assert.equal(a.binding.analysisId, b.binding.analysisId,
    "the loser must adopt the winner's analysis, not create a second");
});

test("a binding never persists a one-time code", { skip }, async () => {
  const session = newSessionId();
  await repos!.bindings.createIfAbsent(binding(session, `${RUN}-nocode`));
  const row = await client!.query<Record<string, unknown>>(
    "select * from lighthouse.launch_analysis_bindings where launch_session_id = $1",
    [session],
  );
  const serialised = JSON.stringify(row.rows[0]).toLowerCase();
  for (const forbidden of ["code", "secret", "token", "password"]) {
    assert.ok(!serialised.includes(`"${forbidden}"`), `${forbidden} present in binding row`);
  }
});

// ---------------------------------------------------------------------------
// SqlAuditSink
// ---------------------------------------------------------------------------

test("an audit event persists with actor, subject, context, authority and correlation", { skip }, async () => {
  await repos!.audit.record({
    eventType: "stage1.redemption",
    occurredAt: new Date().toISOString(),
    actorId: `${RUN}-actor`,
    subjectId: `${RUN}-subject`,
    operatingContext: "professional_assisted",
    authority: { kind: "launch_session", grantId: `${RUN}-grant` },
    purpose: "sponsored_analysis",
    scopes: ["property.basic"],
    outcome: "allowed",
    correlationId: `${RUN}-corr`,
  });

  const rows = await client!.query<Record<string, unknown>>(
    "select * from lighthouse.audit_events where correlation_id = $1",
    [`${RUN}-corr`],
  );
  assert.equal(rows.rows.length, 1);
  const row = rows.rows[0]!;
  assert.equal(row.actor_id, `${RUN}-actor`);
  assert.equal(row.subject_id, `${RUN}-subject`);
  assert.equal(row.operating_context, "professional_assisted");
  assert.equal(row.authority_kind, "launch_session");
  assert.equal(row.outcome, "allowed");
});

test("a secret placed in audit metadata is redacted before it reaches the database", { skip }, async () => {
  const corr = `${RUN}-redact`;
  await repos!.audit.record({
    eventType: "stage1.redemption",
    occurredAt: new Date().toISOString(),
    actorId: `${RUN}-actor`,
    operatingContext: "personal",
    authority: { kind: "self" },
    scopes: [],
    outcome: "denied",
    correlationId: corr,
    metadata: {
      code: "THE-ONE-TIME-CODE",
      secret: "THE-SHARED-SECRET",
      harmless: "keep-me",
    },
  });

  const rows = await client!.query<{ metadata: Record<string, unknown> }>(
    "select metadata from lighthouse.audit_events where correlation_id = $1",
    [corr],
  );
  const stored = JSON.stringify(rows.rows[0]!.metadata);
  assert.ok(!stored.includes("THE-ONE-TIME-CODE"), "one-time code reached the audit table");
  assert.ok(!stored.includes("THE-SHARED-SECRET"), "shared secret reached the audit table");
  assert.ok(stored.includes("keep-me"), "benign metadata should survive");
});

// ---------------------------------------------------------------------------
// P1 defects 1-3 against real Postgres (migration 0013 must be applied)
// ---------------------------------------------------------------------------

test("DEFECT-1 a binding persists its owner and cannot claim the personal context", { skip }, async () => {
  const session = newSessionId();
  await repos!.bindings.createIfAbsent(binding(session, `${RUN}-owned`));
  const found = await repos!.bindings.findByLaunchSession(session);
  assert.equal(found?.professionalActorRef, `${RUN}-actor-pro`);
  assert.equal(found?.operatingContext, "professional_assisted");

  await assert.rejects(
    client!.query(
      `insert into lighthouse.launch_analysis_bindings
         (launch_session_id, analysis_id, analysis_type, correlation_id, property_ref,
          professional_actor_ref, operating_context, initiator_person_ref, cross_product_link_id)
       values ($1, $2, 'investment_quick_review', $3, 'p', 'a', 'personal', 'i', 'l')`,
      [newSessionId(), `${RUN}-personal`, `${RUN}-corr`],
    ),
    /launch_binding_context_is_assisted/,
  );
});

async function confirmedLink(actor: string) {
  const challenge = generateChallenge();
  const invitationId = `${RUN}-inv-${actor}`;
  await repos!.links.createInvitation({
    invitationId, challengeHash: hashChallenge(challenge),
    relationshipOsPersonRef: `${RUN}-ros-${actor}`, relationshipRef: `${RUN}-rel`,
    expiresAt: new Date(Date.now() + 600_000).toISOString(), noticeVersion: "v1",
    correlationId: `${RUN}-link-corr`, consumedAt: null,
  });
  const accepted = await repos!.links.accept({
    invitationId, presentedChallenge: challenge, investscapeActorRef: actor,
    correlationId: `${RUN}-link-corr`, now: new Date(), isEnabled: true,
  });
  assert.ok(accepted.ok);
  return accepted.link;
}

function dbGrant(id: string, linkId: string, actor: string, expiresAt: string | null) {
  return {
    shareGrantId: id, crossProductLinkId: linkId, linkIsActive: true,
    clientUserRef: actor, authenticatedUserRef: actor,
    destinationRelationshipRef: `${RUN}-rel`, recipientContext: "professional_assisted",
    recipientContextEnabled: true, selectedAnalysisIds: [`${RUN}-analysis`], analysesOwnedByClient: true,
    selectedFields: ["grade"], purpose: "p1-db-test", expiresAt, noticeVersion: "v1",
    consentAffirmed: true, now: new Date(), correlationId: `${RUN}-grant-corr`, isEnabled: true,
  };
}

test("DEFECT-3 unlink revokes the link and its active grants in one transaction", { skip }, async () => {
  const actor = `${RUN}-client-cascade`;
  const link = await confirmedLink(actor);
  await repos!.grants.create(dbGrant(`${RUN}-g-cascade`, link.crossProductLinkId, actor, null));

  const revocation = await repos!.links.revokeLink(link.crossProductLinkId, actor, new Date(), link.lifecycle.version);
  assert.deepEqual(revocation?.revokedShareGrantIds, [`${RUN}-g-cascade`]);
  assert.equal((await repos!.grants.findById(`${RUN}-g-cascade`))?.lifecycle.state, "revoked");
});

test("DEFECT-2 the relationship query excludes grants past their expiry", { skip }, async () => {
  const actor = `${RUN}-client-expiry`;
  const link = await confirmedLink(actor);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  await repos!.grants.create(dbGrant(`${RUN}-g-expiry`, link.crossProductLinkId, actor, expiresAt));

  const now = await repos!.grants.findActiveGrantsForRelationship(`${RUN}-rel`, "professional_assisted", new Date());
  assert.ok(now.some((g) => g.shareGrantId === `${RUN}-g-expiry`));
  const later = await repos!.grants.findActiveGrantsForRelationship(
    `${RUN}-rel`, "professional_assisted", new Date(Date.now() + 120_000),
  );
  assert.equal(later.some((g) => g.shareGrantId === `${RUN}-g-expiry`), false);
});

test("launch handoff: sealed code is claimable once, and the claim wipes the ciphertext", { skip }, async () => {
  const { generateHandoffToken, openHandoff, sealHandoff } = await import("../stage1/launchHandoff.ts");
  const token = generateHandoffToken();
  const now = new Date();
  const sealed = sealHandoff({
    handoffId: `${RUN}-handoff`, token, launchSessionId: newSessionId(), code: "db-test-code-" + "x".repeat(40), now,
  });
  await repos!.handoffs.create(sealed, now);

  const raw = await client!.query<Record<string, unknown>>(
    "select * from lighthouse.launch_handoffs where handoff_id = $1", [`${RUN}-handoff`],
  );
  assert.equal(JSON.stringify(raw.rows).includes("db-test-code-"), false, "plaintext code reached the table");

  const claimed = await repos!.handoffs.claim(sealed.tokenHash, `${RUN}-actor`, new Date());
  assert.ok(claimed);
  assert.equal(openHandoff(claimed, token), "db-test-code-" + "x".repeat(40));
  assert.equal(await repos!.handoffs.claim(sealed.tokenHash, `${RUN}-actor`, new Date()), null);

  const after = await client!.query<{ code_ciphertext: string | null; consumed_by_actor_ref: string }>(
    "select code_ciphertext, consumed_by_actor_ref from lighthouse.launch_handoffs where handoff_id = $1",
    [`${RUN}-handoff`],
  );
  assert.equal(after.rows[0]?.code_ciphertext, null);
  assert.equal(after.rows[0]?.consumed_by_actor_ref, `${RUN}-actor`);
});

test("inbound Relationship OS unlink (Stage 6 link store) revokes dependent grants in the same transaction", { skip }, async () => {
  const { createLinkAggregateStore } = await import("../stage6/aggregateStoreAdapters.ts");
  const actor = `${RUN}-client-inbound`;
  const link = await confirmedLink(actor);
  await repos!.grants.create(dbGrant(`${RUN}-g-inbound`, link.crossProductLinkId, actor, null));

  await createLinkAggregateStore(client!).saveState(link.crossProductLinkId, {
    state: "revoked", version: link.lifecycle.version + 1, occurredAt: new Date().toISOString(),
  });

  const linkRow = await client!.query<{ state: string; revoked_at: Date | null }>(
    "select state, revoked_at from lighthouse.cross_product_links where cross_product_link_id = $1",
    [link.crossProductLinkId],
  );
  assert.equal(linkRow.rows[0]?.state, "revoked");
  assert.ok(linkRow.rows[0]?.revoked_at, "link_terminal_has_timestamp satisfied");
  assert.equal((await repos!.grants.findById(`${RUN}-g-inbound`))?.lifecycle.state, "revoked");
});

test("inbound share-grant revocation (generic store) satisfies the terminal-timestamp constraint", { skip }, async () => {
  const { createShareGrantAggregateStore } = await import("../stage6/aggregateStoreAdapters.ts");
  const actor = `${RUN}-client-generic`;
  const link = await confirmedLink(actor);
  await repos!.grants.create(dbGrant(`${RUN}-g-generic`, link.crossProductLinkId, actor, null));
  await createShareGrantAggregateStore(client!).saveState(`${RUN}-g-generic`, {
    state: "revoked", version: 2, occurredAt: new Date().toISOString(),
  });
  assert.equal((await repos!.grants.findById(`${RUN}-g-generic`))?.lifecycle.state, "revoked");
});

test("analysis ownership: only the caller's own, non-deleted personal-workspace deals count", { skip }, async () => {
  const { sqlAnalysisOwnership } = await import("../stage4/analysisOwnership.ts");
  const users = await client!.query<{ id: string }>(
    "insert into auth.users (email) values ($1), ($2) returning id",
    [`${RUN}-owner@example.test`, `${RUN}-other@example.test`],
  );
  const [owner, other] = users.rows.map((r) => r.id);
  const deals = await client!.query<{ id: string }>(
    `insert into investscape.deals (owner_id, deleted_at) values ($1, null), ($1, now()), ($2, null) returning id`,
    [owner, other],
  );
  const [mine, mineDeleted, theirs] = deals.rows.map((r) => r.id);
  const owns = sqlAnalysisOwnership(client!);

  assert.equal(await owns(owner!, [mine!]), true);
  assert.equal(await owns(owner!, [mine!, mine!]), true, "duplicates collapse");
  assert.equal(await owns(owner!, [mine!, theirs!]), false, "one foreign id fails the selection");
  assert.equal(await owns(owner!, [mineDeleted!]), false, "soft-deleted is not shareable");
  assert.equal(await owns(other!, [mine!]), false);

  await client!.query("delete from investscape.deals where owner_id = any($1::uuid[])", [[owner, other]]);
  await client!.query("delete from auth.users where id = any($1::uuid[])", [[owner, other]]);
});

test("cleanup", { skip }, async () => {
  await client!.query("delete from lighthouse.launch_handoffs where handoff_id like $1", [`${RUN}-%`]);
  await client!.query("delete from lighthouse.share_grants where correlation_id like $1", [`${RUN}-%`]);
  await client!.query("delete from lighthouse.cross_product_links where correlation_id like $1", [`${RUN}-%`]);
  await client!.query("delete from lighthouse.link_invitations where correlation_id like $1", [`${RUN}-%`]);
  await client!.query("delete from lighthouse.service_request_nonces where key_id like $1", [`${RUN}-%`]);
  await client!.query("delete from lighthouse.launch_analysis_bindings where correlation_id like $1", [`${RUN}-%`]);
  await client!.query("delete from lighthouse.audit_events where correlation_id like $1", [`${RUN}-%`]);
  await client!.close();
});
