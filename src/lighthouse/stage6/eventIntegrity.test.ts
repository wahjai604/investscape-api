/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Contract v0.3 r3 §3.2–§3.4 rules, against the in-memory store (which
 * serialises and rolls back like a transaction). The same properties are
 * exercised against real Postgres in eventIntegrity.dbtest.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  processInboundEvent,
  type ProcessResult,
} from "./eventIntegrity.ts";
import { InMemoryEventIntegrityStore } from "./eventIntegrityStore.ts";
import {
  computeEventDigest,
  computeVersionContentDigest,
  type EventEnvelope,
} from "./eventDigest.ts";
import { definitionFor, isKnownAggregateKind } from "./lifecycleDispatcher.ts";
import { InMemoryLinkRepository } from "../stage2/linkRepository.ts";
import { InMemoryShareGrantRepository } from "../stage4/shareGrantRepository.ts";

const T0 = "2026-09-28T11:00:00.000Z";

function harness(options: { onSave?: (kind: string, id: string) => void } = {}) {
  let q = 0;
  const store = new InMemoryEventIntegrityStore({
    aggregateKinds: ["link", "share_grant"],
    onSaveAggregate: options.onSave ? (kind, id) => options.onSave!(kind, id) : undefined,
  });
  const deps = {
    store,
    definitionFor: (kind: string) => (isKnownAggregateKind(kind) ? definitionFor(kind) : null),
    now: () => new Date("2026-09-28T12:00:00.000Z"),
    newQuarantineId: () => `Q${++q}`,
  };
  const process = (env: EventEnvelope): Promise<ProcessResult> =>
    processInboundEvent(
      { envelope: env, eventDigest: computeEventDigest(env), versionContentDigest: computeVersionContentDigest(env) },
      deps,
    );
  return { store, deps, process };
}

function grantEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: "E1",
    schemaVersion: "investscape.share-grant.changed.v1",
    aggregateKind: "share_grant",
    aggregateId: "g",
    targetState: "revoked",
    version: 2,
    changeSeq: "900",
    occurredAt: "2026-09-28T12:00:00Z",
    payload: { reason: "client_revoked" },
    ...overrides,
  };
}

function ack(result: ProcessResult) {
  assert.equal(result.kind, "ack");
  return result as Extract<ProcessResult, { kind: "ack" }>;
}

// ---------------------------------------------------------------------------
// Rules 10–11, 7–8
// ---------------------------------------------------------------------------

test("a new event is applied, ledgered and version-ledgered in one step", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  const r = ack(await process(grantEvent()));
  assert.equal(r.httpStatus, 200);
  assert.equal(r.ack.outcome, "applied");
  assert.equal(store.aggregate("share_grant", "g")?.state, "revoked");
  assert.equal(store.ledgerEntry("E1")?.acceptedEventDigest, computeEventDigest(grantEvent()));
  assert.equal(store.versionEntry("share_grant", "g", 2)?.firstEventId, "E1");
  assert.equal(store.variantsFor("E1")[0]?.role, "original");
});

test("a version beyond stored + 1 is applied_with_gap", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  const r = ack(await process(grantEvent({ version: 4 })));
  assert.equal(r.ack.outcome, "applied_with_gap");
  assert.equal(store.aggregate("share_grant", "g")?.version, 4);
});

test("older and equal versions are stale, whatever their occurredAt", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 3, occurredAt: T0 });
  const older = ack(await process(grantEvent({ eventId: "E-old", version: 2, occurredAt: "2099-01-01T00:00:00Z" })));
  assert.equal(older.ack.outcome, "stale");
  // Rule 8: equal version, no version-ledger row (state from a snapshot).
  const equal = ack(await process(grantEvent({ eventId: "E-eq", version: 3, occurredAt: "2099-01-01T00:00:00Z" })));
  assert.equal(equal.ack.outcome, "stale");
  assert.equal(store.aggregate("share_grant", "g")?.state, "active");
});

// ---------------------------------------------------------------------------
// Rule 9 and "revoked grants cannot reactivate"
// ---------------------------------------------------------------------------

test("a revoked grant cannot reactivate: a newer 'active' is 422 and quarantined", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  ack(await process(grantEvent()));
  const r = ack(await process(grantEvent({ eventId: "E-reactivate", targetState: "active", version: 3 })));
  assert.equal(r.httpStatus, 422);
  assert.equal(r.ack.outcome, "rejected_transition");
  assert.equal(store.quarantine(r.ack.quarantineId!)?.kind, "REJECTED_TRANSITION");
  assert.equal(store.aggregate("share_grant", "g")?.state, "revoked");
  assert.equal(store.versionEntry("share_grant", "g", 3), null);
});

test("a revoked grant cannot reactivate: an older 'active' is stale", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  ack(await process(grantEvent({ version: 5 })));
  const r = ack(await process(grantEvent({ eventId: "E-late", targetState: "active", version: 4 })));
  assert.equal(r.ack.outcome, "stale");
  assert.equal(store.aggregate("share_grant", "g")?.state, "revoked");
});

test("a revoked grant cannot reactivate even after its quarantine is resolved", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  ack(await process(grantEvent()));
  const bad = grantEvent({ eventId: "E-reactivate", targetState: "active", version: 3 });
  const r = ack(await process(bad));
  await store.resolveQuarantine({
    quarantineId: r.ack.quarantineId!, resolution: "operator_override",
    resolvedBy: "test", resolvedAt: "2026-09-28T13:00:00Z",
  });
  const retry = ack(await process(bad));
  assert.equal(retry.ack.outcome, "superseded"); // moot, never applied
  const fresh = ack(await process(grantEvent({ eventId: "E-reactivate-2", targetState: "active", version: 3 })));
  assert.equal(fresh.ack.outcome, "rejected_transition");
  assert.equal(store.aggregate("share_grant", "g")?.state, "revoked");
});

// ---------------------------------------------------------------------------
// Rules 4 and 5 — the version ledger
// ---------------------------------------------------------------------------

test("different eventIds with identical version content are aliases (§3.2.1 worked example)", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 4, occurredAt: T0 });
  const e7 = grantEvent({ eventId: "E7", version: 5, changeSeq: "910", occurredAt: "2026-09-28T12:00:00Z" });
  const e7prime = { ...e7, eventId: "E7-prime", occurredAt: "2026-09-28T12:03:10Z" };
  ack(await process(e7));
  const r = ack(await process(e7prime));
  assert.equal(r.httpStatus, 200);
  assert.equal(r.ack.outcome, "duplicate");
  const variant = store.variantsFor("E7-prime")[0]!;
  assert.equal(variant.role, "original");
  assert.equal(variant.outcome, "duplicate");
  assert.equal(variant.aliasOfEventId, "E7");
  assert.equal(store.aggregate("share_grant", "g")?.version, 5);
});

test("same version with different content is a conflict and is quarantined, not tie-broken by occurredAt", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 5, occurredAt: T0 });
  ack(await process(grantEvent({ eventId: "E8", version: 6, targetState: "revoked" })));
  const e9 = grantEvent({ eventId: "E9", version: 6, targetState: "expired", occurredAt: "2099-01-01T00:00:00Z" });
  const r = ack(await process(e9));
  assert.equal(r.httpStatus, 409);
  assert.equal(r.ack.outcome, "conflict");
  assert.equal(r.ack.conflictKind, "AGGREGATE_VERSION_CONTENT_MISMATCH");
  assert.equal(store.aggregate("share_grant", "g")?.state, "revoked");
  assert.equal(store.variantsFor("E9")[0]?.role, "original");
  assert.equal(await store.isAggregateBlocked("share_grant", "g"), true);
  assert.ok(r.quarantineAlert?.opened);
});

test("an alias whose occurredAt differs does not change the alias decision; a changeSeq change does", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  ack(await process(grantEvent({ eventId: "A", changeSeq: "5" })));
  const alias = ack(await process(grantEvent({ eventId: "B", changeSeq: "5", occurredAt: "2026-01-01T00:00:00Z" })));
  assert.equal(alias.ack.outcome, "duplicate");
  const different = ack(await process(grantEvent({ eventId: "C", changeSeq: "6" })));
  assert.equal(different.ack.outcome, "conflict");
});

// ---------------------------------------------------------------------------
// Rules 2, 3 — variants and replay (§3.3 worked example)
// ---------------------------------------------------------------------------

test("variants under one eventId each replay their OWN recorded outcome", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 3, occurredAt: T0 });
  const a1 = grantEvent({ eventId: "E1", version: 4, targetState: "revoked" });
  const b2 = { ...a1, payload: { reason: "b" } };
  const c3 = { ...a1, payload: { reason: "c" } };

  assert.equal(ack(await process(a1)).ack.outcome, "applied");

  const rb = ack(await process(b2));
  assert.equal(rb.httpStatus, 409);
  assert.equal(rb.ack.conflictKind, "EVENT_ID_DIGEST_MISMATCH");
  const q7 = rb.ack.quarantineId!;

  const rc = ack(await process(c3));
  assert.equal(rc.ack.quarantineId, q7, "a second conflicting variant JOINS the open quarantine");
  assert.equal(rc.quarantineAlert?.opened, false);

  // Resends.
  const again = async (e: EventEnvelope) => ack(await process(e));
  const rb2 = await again(b2);
  assert.deepEqual([rb2.httpStatus, rb2.ack.outcome, rb2.ack.quarantineId], [409, "conflict", q7]);
  const rc2 = await again(c3);
  assert.deepEqual([rc2.httpStatus, rc2.ack.outcome, rc2.ack.quarantineId], [409, "conflict", q7]);
  const ra2 = await again(a1);
  assert.deepEqual([ra2.httpStatus, ra2.ack.outcome, ra2.ack.originalOutcome], [200, "duplicate", "applied"]);
  assert.equal(ra2.replayed, true);

  const variants = store.variantsFor("E1");
  assert.equal(variants.length, 3);
  assert.equal(variants.filter((v) => v.role === "original").length, 1);
  assert.equal(variants.find((v) => v.eventDigest === computeEventDigest(b2))?.receivedCount, 2);

  // Resolution: conflicting variants become superseded; the original is untouched.
  assert.equal(await store.resolveQuarantine({
    quarantineId: q7, resolution: "adopted_owner_state", resolvedBy: "test", resolvedAt: "2026-09-28T13:00:00Z",
  }), true);
  assert.equal((await again(b2)).ack.outcome, "superseded");
  assert.equal((await again(b2)).httpStatus, 200);
  assert.equal((await again(c3)).ack.outcome, "superseded");
  const ra3 = await again(a1);
  assert.deepEqual([ra3.ack.outcome, ra3.ack.originalOutcome], ["duplicate", "applied"]);
  assert.equal(store.aggregate("share_grant", "g")?.state, "revoked");
});

test("a conflicting variant that names a different aggregate quarantines the eventId's original aggregate", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  store.seedAggregate("share_grant", "h", { state: "active", version: 1, occurredAt: T0 });
  ack(await process(grantEvent({ aggregateId: "g" })));
  const r = ack(await process(grantEvent({ aggregateId: "h" })));
  assert.equal(r.ack.outcome, "conflict");
  assert.equal(store.quarantine(r.ack.quarantineId!)?.aggregateId, "g");
  assert.equal(store.aggregate("share_grant", "h")?.state, "active");
});

// ---------------------------------------------------------------------------
// Rule 6 and §3.4 — blocked, resolved, resubmitted
// ---------------------------------------------------------------------------

test("§3.4 worked example: blocked, reconciled, resubmitted", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 4, occurredAt: T0 });
  const e5 = grantEvent({ eventId: "E5", version: 5, targetState: "revoked" });
  const e5prime = grantEvent({ eventId: "E5-prime", version: 5, targetState: "expired" });
  ack(await process(e5));
  const conflict = ack(await process(e5prime));
  const q9 = conflict.ack.quarantineId!;

  const e6 = grantEvent({ eventId: "E6", version: 6, targetState: "tombstoned" });
  const blocked = ack(await process(e6));
  assert.deepEqual([blocked.httpStatus, blocked.ack.outcome, blocked.ack.quarantineId], [409, "blocked", q9]);
  assert.equal(blocked.quarantineAlert, null);
  // Still blocked on retry while open.
  assert.equal(ack(await process(e6)).ack.outcome, "blocked");

  // Reconciliation adopts the owner's state (done by hand here: automatic
  // reconciliation is deliberately not implemented), then resolves.
  store.seedAggregate("share_grant", "g", { state: "tombstoned", version: 6, occurredAt: T0 });
  await store.resolveQuarantine({
    quarantineId: q9, resolution: "adopted_owner_state", resolvedBy: "test", resolvedAt: "2026-09-28T13:00:00Z",
  });
  assert.equal(await store.isAggregateBlocked("share_grant", "g"), false);

  const resubmitted = ack(await process(e6));
  assert.equal(resubmitted.ack.outcome, "stale", "version 6 = stored 6, not in the version ledger");
  assert.equal(store.variantsFor("E6")[0]?.outcome, "stale", "the blocked outcome is REPLACED");
  assert.equal(store.variantsFor("E6")[0]?.quarantineId, null);
  // And from now on it replays as a terminal duplicate.
  assert.equal(ack(await process(e6)).ack.outcome, "duplicate");

  const probe = ack(await process(e5prime));
  assert.equal(probe.ack.outcome, "superseded");
});

test("a blocked event resubmitted with DIFFERENT bytes is a new conflicting variant", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  ack(await process(grantEvent({ eventId: "X", version: 2 })));
  ack(await process(grantEvent({ eventId: "Y", version: 2, targetState: "expired" })));
  const blocked = grantEvent({ eventId: "Z", version: 3, targetState: "tombstoned" });
  ack(await process(blocked));
  const changed = ack(await process({ ...blocked, payload: { reason: "different" } }));
  assert.equal(changed.ack.outcome, "conflict");
  assert.equal(changed.ack.conflictKind, "EVENT_ID_DIGEST_MISMATCH");
});

test("an open quarantine stays open: nothing resolves it automatically", async () => {
  const { store, process } = harness();
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  ack(await process(grantEvent({ eventId: "X", version: 2 })));
  const c = ack(await process(grantEvent({ eventId: "Y", version: 2, targetState: "expired" })));
  for (let i = 0; i < 5; i += 1) {
    ack(await process(grantEvent({ eventId: `later-${i}`, version: 3 + i, targetState: "tombstoned" })));
  }
  assert.equal(store.quarantine(c.ack.quarantineId!)?.state, "open");
  assert.equal(await store.isAggregateBlocked("share_grant", "g"), true);
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test("concurrent identical arrivals apply once", async () => {
  let saves = 0;
  const { store, process } = harness({ onSave: () => { saves += 1; } });
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  const event = grantEvent();
  const results = (await Promise.all(Array.from({ length: 8 }, () => process(event)))).map(ack);
  assert.equal(saves, 1);
  assert.equal(results.filter((r) => r.ack.outcome === "applied").length, 1);
  assert.equal(results.filter((r) => r.ack.outcome === "duplicate").length, 7);
  assert.equal(store.variantsFor("E1")[0]?.receivedCount, 8);
});

test("concurrent conflicting arrivals keep both variants and block disclosure", async () => {
  const { store, process } = harness();
  store.seedAggregate("link", "L", { state: "active", version: 1, occurredAt: T0 });
  const links = new InMemoryLinkRepository({ isQuarantined: (k, id) => store.isAggregateBlockedSync(k, id) });
  const grants = new InMemoryShareGrantRepository({ isQuarantined: (k, id) => store.isAggregateBlockedSync(k, id) });
  const base: EventEnvelope = {
    eventId: "EL", schemaVersion: "investscape.link.changed.v1", aggregateKind: "link",
    aggregateId: "L", targetState: "suspended", version: 2, changeSeq: "1", occurredAt: T0, payload: {},
  };
  const [first, second] = (await Promise.all([
    process(base),
    process({ ...base, targetState: "revoked" }),
  ])).map(ack);
  const outcomes = [first!.ack.outcome, second!.ack.outcome].sort();
  assert.deepEqual(outcomes, ["applied", "conflict"]);
  const variants = store.variantsFor("EL");
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map((v) => v.role).sort(), ["conflicting", "original"]);
  assert.equal(await store.isAggregateBlocked("link", "L"), true);
  // Fail closed: the in-memory repositories honour the same predicate.
  assert.equal(await links.findLinkById("L"), null);
  assert.deepEqual(await grants.findActiveGrantsForRelationship("r", "professional_assisted", new Date()), []);
});

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------

test("a failure after the state write rolls back state AND every ledger row", async () => {
  let fail = true;
  const { store, process } = harness({ onSave: () => { if (fail) throw new Error("cascade failed"); } });
  store.seedAggregate("share_grant", "g", { state: "active", version: 1, occurredAt: T0 });
  const before = store.counts;
  await assert.rejects(() => process(grantEvent()), /cascade failed/);
  assert.deepEqual(store.counts, before);
  assert.equal(store.aggregate("share_grant", "g")?.state, "active");
  assert.equal(store.ledgerEntry("E1"), null);

  // Nothing was recorded, so the same bytes are evaluated afresh.
  fail = false;
  assert.equal(ack(await process(grantEvent())).ack.outcome, "applied");
});

test("an aggregate InvestScape never created records nothing", async () => {
  const { store, process } = harness();
  const result = await process(grantEvent({ aggregateId: "missing" }));
  assert.equal(result.kind, "aggregate_not_found");
  assert.deepEqual(store.counts, { ledger: 0, variants: 0, versions: 0, quarantines: 0 });
});

test("an aggregate kind with no wired store records nothing", async () => {
  const { store, process } = harness();
  const result = await process(grantEvent({ aggregateKind: "mandate" }));
  assert.equal(result.kind, "store_not_configured");
  assert.deepEqual(store.counts, { ledger: 0, variants: 0, versions: 0, quarantines: 0 });
});
