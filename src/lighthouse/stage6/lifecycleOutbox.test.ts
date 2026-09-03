/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 6 outbound outbox tests. Mirrors stage1/stage1.test.ts's outbox
 * section — pure-function assertions plus the in-memory repository, no HTTP.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryLifecycleOutboxRepository,
  applyDeliveryOutcome,
  backoffDelayMs,
  classifyResponse,
  enqueueOutboundEvent,
  hashPayload,
  type LifecycleOutboxEntry,
} from "./lifecycleOutbox.ts";
import { dispatchPendingOutboxEntries } from "./outboundDispatcher.ts";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const enqueueDeps = { now: () => NOW, newId: () => `id-${Math.random()}` };

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt-1",
    aggregateKind: "link",
    aggregateId: "link-1",
    targetState: "revoked",
    version: 2,
    occurredAt: NOW.toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Enqueue / idempotency
// ---------------------------------------------------------------------------

test("enqueueing a new event creates a pending entry", async () => {
  const repo = new InMemoryLifecycleOutboxRepository();
  const result = await enqueueOutboundEvent(
    { aggregateKind: "link", aggregateId: "link-1", payload: eventPayload() },
    repo,
    enqueueDeps,
  );
  assert.equal(result.deduplicated, false);
  assert.equal(result.entry.state, "pending");
  assert.equal(result.entry.attempts, 0);
});

test("enqueueing the identical payload twice is idempotent", async () => {
  const repo = new InMemoryLifecycleOutboxRepository();
  const first = await enqueueOutboundEvent(
    { aggregateKind: "link", aggregateId: "link-1", payload: eventPayload() },
    repo, enqueueDeps,
  );
  const second = await enqueueOutboundEvent(
    { aggregateKind: "link", aggregateId: "link-1", payload: eventPayload() },
    repo, enqueueDeps,
  );
  assert.equal(second.deduplicated, true);
  assert.equal(second.entry.id, first.entry.id);
  assert.equal(repo.all.length, 1);
});

test("a different payload for the same aggregate creates a distinct entry", async () => {
  const repo = new InMemoryLifecycleOutboxRepository();
  await enqueueOutboundEvent(
    { aggregateKind: "link", aggregateId: "link-1", payload: eventPayload({ version: 2 }) },
    repo, enqueueDeps,
  );
  await enqueueOutboundEvent(
    { aggregateKind: "link", aggregateId: "link-1", payload: eventPayload({ version: 3 }) },
    repo, enqueueDeps,
  );
  assert.equal(repo.all.length, 2);
});

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

test("backoff is bounded exponential", () => {
  assert.equal(backoffDelayMs(1), 1000);
  assert.equal(backoffDelayMs(2), 2000);
  assert.equal(backoffDelayMs(3), 4000);
  assert.ok(backoffDelayMs(20) <= 300_000, "backoff must stay bounded");
});

test("classifyResponse maps status codes correctly", () => {
  assert.equal(classifyResponse(200).kind, "acknowledged");
  assert.equal(classifyResponse(409).kind, "permanent");
  assert.equal(classifyResponse(400).kind, "permanent");
  assert.equal(classifyResponse(500).kind, "retryable");
  assert.equal(classifyResponse(503).kind, "retryable");
  assert.equal(classifyResponse(429).kind, "retryable");
});

// ---------------------------------------------------------------------------
// Terminal-state invariant
// ---------------------------------------------------------------------------

function baseEntry(): LifecycleOutboxEntry {
  const payload = JSON.stringify(eventPayload());
  return {
    id: "outbox-1",
    aggregateKind: "link",
    aggregateId: "link-1",
    payload,
    payloadHash: hashPayload(payload),
    state: "pending",
    attempts: 0,
    nextAttemptAt: NOW.toISOString(),
  };
}

test("a bounded number of retryable failures reaches failed_permanent", async () => {
  let entry = baseEntry();
  for (let i = 0; i < 10; i++) {
    if (entry.state === "failed_permanent") break;
    entry = applyDeliveryOutcome(entry, { kind: "retryable", reason: "server_500" }, NOW);
  }
  assert.equal(entry.state, "failed_permanent");
  assert.ok(entry.attempts <= 6);
});

test("a terminal state is never overwritten by a later status", () => {
  let entry = baseEntry();
  entry = applyDeliveryOutcome(entry, { kind: "acknowledged" }, NOW);
  assert.equal(entry.state, "acknowledged");

  const attemptedRegression = applyDeliveryOutcome(entry, { kind: "retryable", reason: "server_500" }, NOW);
  assert.equal(attemptedRegression.state, "acknowledged", "terminal state was overwritten");

  const attemptedPermanent = applyDeliveryOutcome(entry, { kind: "permanent", reason: "client_400" }, NOW);
  assert.equal(attemptedPermanent.state, "acknowledged", "terminal state was overwritten");
});

test("failed_permanent is also terminal — never reverts to pending", () => {
  let entry = baseEntry();
  entry = applyDeliveryOutcome(entry, { kind: "permanent", reason: "client_400" }, NOW);
  assert.equal(entry.state, "failed_permanent");

  const reverted = applyDeliveryOutcome(entry, { kind: "acknowledged" }, NOW);
  assert.equal(reverted.state, "failed_permanent");
});

test("a retryable failure schedules the next attempt with backoff", () => {
  const entry = baseEntry();
  const retried = applyDeliveryOutcome(entry, { kind: "retryable", reason: "server_503" }, NOW);
  assert.equal(retried.state, "pending");
  assert.equal(retried.attempts, 1);
  assert.ok(new Date(retried.nextAttemptAt) > NOW);
});

// ---------------------------------------------------------------------------
// Sweep — dispatchPendingOutboxEntries
// ---------------------------------------------------------------------------

const config = { baseUrl: "https://relationship-os.example", keyId: "is-key", secret: "s".repeat(64) };

test("the sweep acknowledges a due entry on a 200", async () => {
  const repo = new InMemoryLifecycleOutboxRepository();
  await enqueueOutboundEvent(
    { aggregateKind: "link", aggregateId: "link-1", payload: eventPayload() },
    repo, enqueueDeps,
  );
  const fakeFetch = (async () => new Response(null, { status: 200 })) as typeof globalThis.fetch;
  const result = await dispatchPendingOutboxEntries(NOW, { repository: repo, config, fetch: fakeFetch });
  assert.equal(result.acknowledged, 1);
  assert.equal(repo.all[0]?.state, "acknowledged");
});

test("the sweep retries with backoff on a transport failure", async () => {
  const repo = new InMemoryLifecycleOutboxRepository();
  await enqueueOutboundEvent(
    { aggregateKind: "link", aggregateId: "link-1", payload: eventPayload() },
    repo, enqueueDeps,
  );
  const fakeFetch = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof globalThis.fetch;
  const result = await dispatchPendingOutboxEntries(NOW, { repository: repo, config, fetch: fakeFetch });
  assert.equal(result.retried, 1);
  const entry = repo.all[0];
  assert.equal(entry?.state, "pending");
  assert.equal(entry?.attempts, 1);
  assert.ok(new Date(entry!.nextAttemptAt) > NOW);
});

test("the sweep is a no-op when the outbound service is unconfigured", async () => {
  const repo = new InMemoryLifecycleOutboxRepository();
  await enqueueOutboundEvent(
    { aggregateKind: "link", aggregateId: "link-1", payload: eventPayload() },
    repo, enqueueDeps,
  );
  const fakeFetch = (async () => new Response(null, { status: 200 })) as typeof globalThis.fetch;
  const result = await dispatchPendingOutboxEntries(NOW, { repository: repo, config: null, fetch: fakeFetch });
  assert.deepEqual(result, { processed: 0, acknowledged: 0, retried: 0, failedPermanent: 0 });
  assert.equal(repo.all[0]?.state, "pending");
});
