/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * REAL DATABASE tests for Stage 6 event integrity (migration 0015, contract
 * v0.3 r3 §3.2–§3.4). Run only when DATABASE_URL is set; point it at a
 * DISPOSABLE Postgres, never a shared one:
 *
 *   docker run -d --name lighthouse-pg -e POSTGRES_PASSWORD=... -p 55432:5432 postgres:17-alpine
 *   npm run migrate:lighthouse
 *   npm run test:db
 *
 * Concurrency here is real: parallel calls take separate pooled connections
 * and contend on the advisory and row locks. Every id carries a run prefix;
 * nothing is deleted afterwards because the ledgers are immutable by trigger.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import { createPgClientFromEnv } from "../persistence/pgClient.ts";
import type { SqlClient, TransactionalSqlClient } from "../persistence/types.ts";
import { SqlEventIntegrityStore } from "./eventIntegrityStore.ts";
import { processInboundEvent, type ProcessResult } from "./eventIntegrity.ts";
import { computeEventDigest, computeVersionContentDigest, type EventEnvelope } from "./eventDigest.ts";
import { definitionFor, isKnownAggregateKind } from "./lifecycleDispatcher.ts";
import { SqlLinkRepository } from "../stage2/linkRepository.ts";
import { SqlShareGrantRepository } from "../stage4/shareGrantRepository.ts";
import {
  SqlLifecycleOutboxRepository,
  applyDeliveryOutcome,
  hashPayload,
} from "./lifecycleOutbox.ts";

dotenv.config();

const client = createPgClientFromEnv();
const skip = client === null ? "DATABASE_URL not set" : false;
const RUN = `ei${Date.now().toString(36)}`;
const id = (n: string) => `${RUN}-${n}`;
const KINDS = ["link", "share_grant", "admin_assignment", "mandate"];

after(async () => {
  await (client as unknown as { close?: () => Promise<void> } | null)?.close?.();
});

let q = 0;
function processWith(sql: TransactionalSqlClient) {
  const store = new SqlEventIntegrityStore(sql, { aggregateKinds: KINDS });
  const run = (env: EventEnvelope): Promise<ProcessResult> =>
    processInboundEvent(
      { envelope: env, eventDigest: computeEventDigest(env), versionContentDigest: computeVersionContentDigest(env) },
      {
        store,
        definitionFor: (kind) => (isKnownAggregateKind(kind) ? definitionFor(kind) : null),
        now: () => new Date(),
        newQuarantineId: () => id(`Q${++q}`),
      },
    );
  return { store, run };
}

function ack(result: ProcessResult) {
  assert.equal(result.kind, "ack", JSON.stringify(result));
  return result as Extract<ProcessResult, { kind: "ack" }>;
}

async function seedLink(linkId: string, actor: string, relationship: string): Promise<void> {
  await client!.query(
    `insert into lighthouse.cross_product_links
       (cross_product_link_id, relationship_os_person_ref, investscape_actor_ref, relationship_ref,
        state, version, notice_version, accepted_at, correlation_id)
     values ($1, $2, $3, $4, 'active', 1, 'v1', now(), $5)`,
    [linkId, `${linkId}-person`, actor, relationship, `${linkId}-corr`],
  );
}

async function seedGrant(grantId: string, linkId: string, actor: string, relationship: string): Promise<void> {
  await client!.query(
    `insert into lighthouse.share_grants
       (share_grant_id, cross_product_link_id, client_user_ref, destination_relationship_ref,
        recipient_context, purpose, effective_from, consent, correlation_id, state, version)
     values ($1, $2, $3, $4, 'professional_assisted', 'advice', now() - interval '1 hour',
             '{}'::jsonb, $5, 'active', 1)`,
    [grantId, linkId, actor, relationship, `${grantId}-corr`],
  );
}

async function row(sql: string, params: readonly unknown[]): Promise<Record<string, unknown> | undefined> {
  return (await client!.query<Record<string, unknown>>(sql, params)).rows[0];
}

async function count(sql: string, params: readonly unknown[]): Promise<number> {
  return Number((await row(`select count(*)::int as n from (${sql}) x`, params))?.n);
}

function grantEvent(grantId: string, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: id(`E-${Math.random().toString(36).slice(2)}`),
    schemaVersion: "investscape.share-grant.changed.v1",
    aggregateKind: "share_grant",
    aggregateId: grantId,
    targetState: "revoked",
    version: 2,
    changeSeq: "100",
    occurredAt: "2026-09-28T12:00:00Z",
    payload: { reason: "client_revoked" },
    ...overrides,
  };
}

function linkEvent(linkId: string, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: id(`L-${Math.random().toString(36).slice(2)}`),
    schemaVersion: "investscape.link.changed.v1",
    aggregateKind: "link",
    aggregateId: linkId,
    targetState: "suspended",
    version: 2,
    changeSeq: "200",
    occurredAt: "2026-09-28T12:00:00Z",
    payload: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test("concurrent identical arrivals apply once", { skip }, async () => {
  const { run } = processWith(client!);
  const grant = id("g-concurrent");
  await seedLink(id("l-concurrent"), id("actor-c"), id("rel-c"));
  await seedGrant(grant, id("l-concurrent"), id("actor-c"), id("rel-c"));
  const event = grantEvent(grant);

  const results = (await Promise.all(Array.from({ length: 8 }, () => run(event)))).map(ack);
  const outcomes = results.map((r) => r.ack.outcome).sort();
  assert.deepEqual(outcomes, ["applied", ...Array(7).fill("duplicate")]);

  const stored = await row("select state, version from lighthouse.share_grants where share_grant_id = $1", [grant]);
  assert.deepEqual(stored, { state: "revoked", version: 2 });
  assert.equal(await count("select 1 from lighthouse.event_variants where event_id = $1", [event.eventId]), 1);
  assert.equal(
    (await row("select received_count from lighthouse.event_variants where event_id = $1", [event.eventId]))?.received_count,
    8,
  );
  assert.equal(await count("select 1 from lighthouse.version_ledger where aggregate_id = $1", [grant]), 1);
});

test("concurrent conflicting arrivals under one eventId keep both variants and block disclosure", { skip }, async () => {
  const { run, store } = processWith(client!);
  const link = id("l-conflict");
  const actor = id("actor-x");
  const relationship = id("rel-x");
  await seedLink(link, actor, relationship);
  await seedGrant(id("g-on-conflicted-link"), link, actor, relationship);

  const links = new SqlLinkRepository(client!);
  const grants = new SqlShareGrantRepository(client!);
  assert.ok(await links.findLinkById(link), "readable before the conflict");
  assert.equal((await grants.findActiveGrantsForRelationship(relationship, "professional_assisted", new Date())).length, 1);

  const base = linkEvent(link);
  const results = (await Promise.all([run(base), run({ ...base, payload: { note: "other bytes" } })])).map(ack);
  assert.deepEqual(results.map((r) => r.ack.outcome).sort(), ["applied", "conflict"]);

  const variants = (await client!.query<{ role: string; outcome: string; quarantine_id: string | null }>(
    "select role, outcome, quarantine_id from lighthouse.event_variants where event_id = $1 order by role",
    [base.eventId],
  )).rows;
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map((v) => [v.role, v.outcome]), [["conflicting", "conflict"], ["original", "applied"]]);
  assert.ok(variants[0]!.quarantine_id);

  assert.equal(await store.isAggregateBlocked("link", link), true);
  assert.equal(await links.findLinkById(link), null, "link reads fail closed");
  assert.deepEqual(await links.findActiveLinksForActor(actor), []);
  assert.deepEqual(
    await grants.findActiveGrantsForRelationship(relationship, "professional_assisted", new Date()),
    [],
    "nothing is disclosed through a grant riding on a quarantined link",
  );
});

test("concurrent arrivals of one version under different eventIds: one applies, the other is a content conflict", { skip }, async () => {
  const { run } = processWith(client!);
  const grant = id("g-version-race");
  await seedLink(id("l-vr"), id("actor-vr"), id("rel-vr"));
  await seedGrant(grant, id("l-vr"), id("actor-vr"), id("rel-vr"));
  const results = (await Promise.all([
    run(grantEvent(grant, { targetState: "revoked" })),
    run(grantEvent(grant, { targetState: "expired" })),
  ])).map(ack);
  const outcomes = results.map((r) => r.ack.outcome).sort();
  assert.deepEqual(outcomes, ["applied", "conflict"]);
  assert.equal(results.find((r) => r.ack.outcome === "conflict")?.ack.conflictKind, "AGGREGATE_VERSION_CONTENT_MISMATCH");
  assert.equal(await count("select 1 from lighthouse.version_ledger where aggregate_id = $1", [grant]), 1);
});

// ---------------------------------------------------------------------------
// Variants, replay and resolution
// ---------------------------------------------------------------------------

test("retries reproduce each variant's recorded outcome, before and after resolution", { skip }, async () => {
  const { run, store } = processWith(client!);
  const grant = id("g-variants");
  await seedLink(id("l-var"), id("actor-var"), id("rel-var"));
  await seedGrant(grant, id("l-var"), id("actor-var"), id("rel-var"));
  const a1 = grantEvent(grant);
  const b2 = { ...a1, payload: { reason: "b" } };
  const c3 = { ...a1, payload: { reason: "c" } };

  assert.equal(ack(await run(a1)).ack.outcome, "applied");
  const q7 = ack(await run(b2)).ack.quarantineId!;
  assert.equal(ack(await run(c3)).ack.quarantineId, q7);

  for (const [event, status, outcome] of [[b2, 409, "conflict"], [c3, 409, "conflict"], [a1, 200, "duplicate"]] as const) {
    const r = ack(await run(event));
    assert.equal(r.httpStatus, status);
    assert.equal(r.ack.outcome, outcome);
  }
  assert.equal(ack(await run(a1)).ack.originalOutcome, "applied");

  assert.equal(await store.resolveQuarantine({
    quarantineId: q7, resolution: "operator_override", resolvedBy: "dbtest", resolvedAt: new Date().toISOString(),
  }), true);
  assert.equal(ack(await run(b2)).ack.outcome, "superseded");
  assert.equal(ack(await run(c3)).ack.outcome, "superseded");
  assert.equal(ack(await run(a1)).ack.outcome, "duplicate");
  assert.equal(
    (await row("select state from lighthouse.share_grants where share_grant_id = $1", [grant]))?.state,
    "revoked",
  );
});

test("different eventIds with identical version content are aliases", { skip }, async () => {
  const { run } = processWith(client!);
  const grant = id("g-alias");
  await seedLink(id("l-alias"), id("actor-alias"), id("rel-alias"));
  await seedGrant(grant, id("l-alias"), id("actor-alias"), id("rel-alias"));
  const e7 = grantEvent(grant, { changeSeq: "910" });
  const e7prime = { ...e7, eventId: id("E7-prime"), occurredAt: "2026-09-28T12:03:10Z" };
  ack(await run(e7));
  const r = ack(await run(e7prime));
  assert.equal(r.httpStatus, 200);
  assert.equal(r.ack.outcome, "duplicate");
  assert.equal(
    (await row("select alias_of_event_id from lighthouse.event_variants where event_id = $1", [e7prime.eventId]))?.alias_of_event_id,
    e7.eventId,
  );
});

test("the same version with different content is quarantined and blocks later events", { skip }, async () => {
  const { run, store } = processWith(client!);
  const grant = id("g-content");
  await seedLink(id("l-content"), id("actor-content"), id("rel-content"));
  await seedGrant(grant, id("l-content"), id("actor-content"), id("rel-content"));
  ack(await run(grantEvent(grant, { targetState: "revoked" })));
  const conflict = ack(await run(grantEvent(grant, { targetState: "expired" })));
  assert.equal(conflict.httpStatus, 409);
  assert.equal(conflict.ack.conflictKind, "AGGREGATE_VERSION_CONTENT_MISMATCH");
  assert.equal(await store.isAggregateBlocked("share_grant", grant), true);

  const later = ack(await run(grantEvent(grant, { targetState: "tombstoned", version: 3 })));
  assert.equal(later.ack.outcome, "blocked");
  assert.equal(later.ack.quarantineId, conflict.ack.quarantineId);
  assert.equal((await row("select version from lighthouse.share_grants where share_grant_id = $1", [grant]))?.version, 2);
});

// ---------------------------------------------------------------------------
// Revoked grants cannot reactivate
// ---------------------------------------------------------------------------

test("a revoked grant cannot reactivate, directly or after a link cascade", { skip }, async () => {
  const { run } = processWith(client!);
  const link = id("l-cascade");
  const grant = id("g-cascade");
  await seedLink(link, id("actor-cas"), id("rel-cas"));
  await seedGrant(grant, link, id("actor-cas"), id("rel-cas"));

  // An inbound link revocation cascades into the grant in the same transaction.
  assert.equal(ack(await run(linkEvent(link, { targetState: "revoked" }))).ack.outcome, "applied");
  const cascaded = await row("select state, version from lighthouse.share_grants where share_grant_id = $1", [grant]);
  assert.equal(cascaded?.state, "revoked");

  const reactivate = ack(await run(grantEvent(grant, { targetState: "active", version: Number(cascaded?.version) + 1 })));
  assert.equal(reactivate.httpStatus, 422);
  assert.equal(reactivate.ack.outcome, "rejected_transition");
  const older = ack(await run(grantEvent(grant, { targetState: "active", version: 1 })));
  assert.equal(older.ack.outcome, "blocked", "the open quarantine now blocks everything for the grant");
  assert.equal((await row("select state from lighthouse.share_grants where share_grant_id = $1", [grant]))?.state, "revoked");
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/** A client whose transactions fail on one chosen statement — AFTER the state write. */
function failingOn(prefix: string): TransactionalSqlClient {
  return {
    query: (sql, params) => client!.query(sql, params),
    transaction: (fn) =>
      client!.transaction((tx: SqlClient) =>
        fn({
          query: async (sql, params) => {
            if (sql.trim().toLowerCase().startsWith(prefix)) throw new Error("injected failure");
            return tx.query(sql, params);
          },
        } as SqlClient),
      ),
  };
}

test("a failure after the state write leaves state and every ledger consistent (rolled back)", { skip }, async () => {
  const link = id("l-rollback");
  const grant = id("g-rollback");
  await seedLink(link, id("actor-rb"), id("rel-rb"));
  await seedGrant(grant, link, id("actor-rb"), id("rel-rb"));
  const event = linkEvent(link, { targetState: "revoked" });

  // The version-ledger insert runs after the link update AND the grant cascade.
  const { run: failing } = processWith(failingOn("insert into lighthouse.version_ledger"));
  await assert.rejects(() => failing(event), /injected failure/);

  assert.equal((await row("select state from lighthouse.cross_product_links where cross_product_link_id = $1", [link]))?.state, "active");
  assert.equal((await row("select state from lighthouse.share_grants where share_grant_id = $1", [grant]))?.state, "active",
    "the cascade rolled back with the link");
  assert.equal(await count("select 1 from lighthouse.event_ledger where event_id = $1", [event.eventId]), 0);
  assert.equal(await count("select 1 from lighthouse.event_variants where event_id = $1", [event.eventId]), 0);
  assert.equal(await count("select 1 from lighthouse.version_ledger where aggregate_id = $1", [link]), 0);

  // Nothing was recorded, so the same bytes are simply evaluated again.
  const { run } = processWith(client!);
  assert.equal(ack(await run(event)).ack.outcome, "applied");
  assert.equal((await row("select state from lighthouse.share_grants where share_grant_id = $1", [grant]))?.state, "revoked");
});

test("a failure while opening a quarantine records neither the quarantine nor the variant", { skip }, async () => {
  const grant = id("g-rollback-q");
  await seedLink(id("l-rbq"), id("actor-rbq"), id("rel-rbq"));
  await seedGrant(grant, id("l-rbq"), id("actor-rbq"), id("rel-rbq"));
  const { run } = processWith(client!);
  const original = grantEvent(grant);
  ack(await run(original));

  const conflicting = { ...original, payload: { reason: "other" } };
  const { run: failing } = processWith(failingOn("insert into lighthouse.event_variants"));
  await assert.rejects(() => failing(conflicting), /injected failure/);
  assert.equal(await count(
    "select 1 from lighthouse.event_quarantines where aggregate_id = $1", [grant]), 0);
  assert.equal(await count("select 1 from lighthouse.event_variants where event_id = $1", [original.eventId]), 1);
});

// ---------------------------------------------------------------------------
// Immutability, enforced by the database
// ---------------------------------------------------------------------------

test("ledger rows, recorded outcomes and resolved quarantines cannot be rewritten", { skip }, async () => {
  const { run, store } = processWith(client!);
  const grant = id("g-immutable");
  await seedLink(id("l-imm"), id("actor-imm"), id("rel-imm"));
  await seedGrant(grant, id("l-imm"), id("actor-imm"), id("rel-imm"));
  const event = grantEvent(grant);
  ack(await run(event));
  const quarantineId = ack(await run({ ...event, payload: { reason: "x" } })).ack.quarantineId!;

  await assert.rejects(() => client!.query(
    "update lighthouse.event_ledger set version = 99 where event_id = $1", [event.eventId]), /immutable/);
  await assert.rejects(() => client!.query(
    "delete from lighthouse.version_ledger where aggregate_id = $1", [grant]), /immutable/);
  await assert.rejects(() => client!.query(
    "update lighthouse.event_variants set outcome = 'stale' where event_id = $1 and role = 'original'",
    [event.eventId]), /recorded once/);
  await assert.rejects(() => client!.query(
    "delete from lighthouse.event_variants where event_id = $1", [event.eventId]), /never deleted/);

  await store.resolveQuarantine({
    quarantineId, resolution: "operator_override", resolvedBy: "dbtest", resolvedAt: new Date().toISOString(),
  });
  await assert.rejects(() => client!.query(
    `update lighthouse.event_quarantines set state = 'open', resolution = null, resolved_by = null, resolved_at = null
      where quarantine_id = $1`, [quarantineId]), /final/);
  assert.equal(await store.resolveQuarantine({
    quarantineId, resolution: "operator_override", resolvedBy: "dbtest", resolvedAt: new Date().toISOString(),
  }), false);
});

test("at most one open quarantine per aggregate", { skip }, async () => {
  const aggregateId = id("g-one-open");
  const insert = (qid: string) => client!.query(
    `insert into lighthouse.event_quarantines (quarantine_id, aggregate_kind, aggregate_id, version, kind, opened_at)
     values ($1, 'share_grant', $2, 2, 'REJECTED_TRANSITION', now())`, [qid, aggregateId]);
  await insert(id("q-a"));
  await assert.rejects(() => insert(id("q-b")));
});

// ---------------------------------------------------------------------------
// Sender reconciliation states persist
// ---------------------------------------------------------------------------

test("the sender outbox persists awaiting_reconciliation, in_quarantine and superseded", { skip }, async () => {
  const outbox = new SqlLifecycleOutboxRepository(client!);
  const payload = JSON.stringify({ eventId: id("out-1") });
  const now = new Date();
  const { entry } = await outbox.enqueue({
    id: id("outbox-1"), aggregateKind: "share_grant", aggregateId: id("g-out"),
    payload, payloadHash: hashPayload(payload), state: "pending", attempts: 0,
    nextAttemptAt: now.toISOString(),
  });

  const parked = applyDeliveryOutcome(entry, { kind: "awaiting_reconciliation", quarantineId: "Q-out" }, now);
  await outbox.update(parked);
  let stored = await outbox.findByAggregateAndHash("share_grant", id("g-out"), hashPayload(payload));
  assert.equal(stored?.state, "awaiting_reconciliation");
  assert.equal(stored?.quarantineId, "Q-out");
  assert.equal(stored?.payload, payload);
  assert.equal((await outbox.dueEntries(new Date(now.getTime() + 86_400_000), 100))
    .some((e) => e.id === entry.id), false, "not picked up by the sweep");

  const superseded = applyDeliveryOutcome(
    applyDeliveryOutcome(stored!, { kind: "in_quarantine", quarantineId: "Q-out", outcome: "conflict" }, now),
    { kind: "superseded" }, now,
  );
  await outbox.update(superseded);
  stored = await outbox.findByAggregateAndHash("share_grant", id("g-out"), hashPayload(payload));
  assert.equal(stored?.state, "superseded");
  assert.ok(stored?.supersededAt);
  assert.equal(stored?.acknowledgedAt, undefined);

  // A terminal row is not rewritten, even by a direct repository update.
  await outbox.update({ ...stored!, state: "pending" });
  assert.equal((await outbox.findByAggregateAndHash("share_grant", id("g-out"), hashPayload(payload)))?.state, "superseded");

  await assert.rejects(() => client!.query(
    "update lighthouse.lifecycle_outbox set state = 'awaiting_reconciliation', quarantine_id = null where outbox_id = $1",
    [id("outbox-1")]));
});
