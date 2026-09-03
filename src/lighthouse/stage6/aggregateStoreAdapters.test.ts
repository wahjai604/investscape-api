/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Tests for the real `LifecycleAggregateStore` SQL adapters, and for
 * `lifecycleDispatcher.ts`'s handling of `AggregateNotFoundError`.
 *
 * A minimal fake `SqlClient` stands in for Postgres: it understands exactly
 * the two query shapes `aggregateStoreAdapters.ts` issues (a `select` by id,
 * and a conditional `update ... where id = $n and version < $v`) against an
 * in-memory row map, which is enough to exercise the adapter's real logic
 * without needing a live database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SqlClient, SqlQueryResult } from "../persistence/types.ts";
import {
  createLinkAggregateStore,
  AggregateNotFoundError,
} from "./aggregateStoreAdapters.ts";
import {
  dispatchLifecycleEvent,
  type LifecycleAggregateStore,
} from "./lifecycleDispatcher.ts";

interface FakeRow {
  state: string;
  version: number;
  occurred_at: string;
}

class FakeSqlClient implements SqlClient {
  readonly rows = new Map<string, FakeRow>();

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<SqlQueryResult<TRow>> {
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith("select state")) {
      const id = params[0] as string;
      const row = this.rows.get(id);
      if (!row) return { rows: [], rowCount: 0 };
      return { rows: [row as unknown as TRow], rowCount: 1 };
    }

    if (normalized.startsWith("update")) {
      const [newState, newVersion, occurredAt, id] = params as [string, number, string, string];
      const existing = this.rows.get(id);
      if (existing && existing.version < newVersion) {
        this.rows.set(id, { state: newState, version: newVersion, occurred_at: occurredAt });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("select 1")) {
      const id = params[0] as string;
      return this.rows.has(id) ? { rows: [{} as TRow], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    throw new Error(`FakeSqlClient: unrecognised query: ${sql}`);
  }
}

// ---------------------------------------------------------------------------
// Adapter-level: load/save round trip and version guard
// ---------------------------------------------------------------------------

test("loadState returns null for an aggregate with no local row", async () => {
  const client = new FakeSqlClient();
  const store = createLinkAggregateStore(client);
  assert.equal(await store.loadState("link-1"), null);
});

test("loadState returns the current state, version and occurredAt", async () => {
  const client = new FakeSqlClient();
  client.rows.set("link-1", { state: "active", version: 3, occurred_at: "2026-09-03T00:00:00.000Z" });
  const store = createLinkAggregateStore(client);
  const state = await store.loadState("link-1");
  assert.deepEqual(state, { state: "active", version: 3, occurredAt: "2026-09-03T00:00:00.000Z" });
});

test("saveState writes a new state onto an existing row", async () => {
  const client = new FakeSqlClient();
  client.rows.set("link-1", { state: "pending", version: 1, occurred_at: "2026-09-01T00:00:00.000Z" });
  const store = createLinkAggregateStore(client);
  await store.saveState("link-1", { state: "active", version: 2, occurredAt: "2026-09-02T00:00:00.000Z" });
  assert.deepEqual(client.rows.get("link-1"), {
    state: "active", version: 2, occurred_at: "2026-09-02T00:00:00.000Z",
  });
});

test("saveState is a silent no-op when the row already moved past this version (stale write)", async () => {
  const client = new FakeSqlClient();
  client.rows.set("link-1", { state: "active", version: 5, occurred_at: "2026-09-03T00:00:00.000Z" });
  const store = createLinkAggregateStore(client);
  // Attempting to write version 2 onto a row already at version 5.
  await store.saveState("link-1", { state: "suspended", version: 2, occurredAt: "2026-09-01T00:00:00.000Z" });
  // Row is untouched — the newer state already there wins.
  assert.deepEqual(client.rows.get("link-1"), {
    state: "active", version: 5, occurred_at: "2026-09-03T00:00:00.000Z",
  });
});

test("saveState throws AggregateNotFoundError when no local row exists at all", async () => {
  const client = new FakeSqlClient();
  const store = createLinkAggregateStore(client);
  await assert.rejects(
    () => store.saveState("never-created", { state: "active", version: 1, occurredAt: "2026-09-03T00:00:00.000Z" }),
    (error: unknown) => error instanceof AggregateNotFoundError,
  );
});

// ---------------------------------------------------------------------------
// Dispatcher-level: AggregateNotFoundError surfaces as a clean denial, not a
// false "applied" result or an unhandled throw.
// ---------------------------------------------------------------------------

test("dispatchLifecycleEvent reports AGGREGATE_NOT_FOUND rather than a false 'applied'", async () => {
  const client = new FakeSqlClient();
  const store: LifecycleAggregateStore = createLinkAggregateStore(client);

  const result = await dispatchLifecycleEvent(
    "link",
    "never-created",
    {
      eventId: "e1",
      targetState: "active",
      version: 1,
      occurredAt: "2026-09-03T00:00:00.000Z",
      payloadHash: "a".repeat(64),
    },
    { stores: { link: store } },
  );

  assert.deepEqual(result, { ok: false, reason: "AGGREGATE_NOT_FOUND" });
  // And the row genuinely was not created as a side effect.
  assert.equal(client.rows.size, 0);
});

test("dispatchLifecycleEvent applies cleanly and persists when the row already exists", async () => {
  const client = new FakeSqlClient();
  client.rows.set("link-1", { state: "pending", version: 1, occurred_at: "2026-09-01T00:00:00.000Z" });
  const store: LifecycleAggregateStore = createLinkAggregateStore(client);

  const result = await dispatchLifecycleEvent(
    "link",
    "link-1",
    {
      eventId: "e1",
      targetState: "active",
      version: 2,
      occurredAt: "2026-09-03T00:00:00.000Z",
      payloadHash: "a".repeat(64),
    },
    { stores: { link: store } },
  );

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.outcome.kind, "applied");
  assert.equal(client.rows.get("link-1")?.state, "active");
});

test("a genuinely unrelated store error still propagates rather than being swallowed as AGGREGATE_NOT_FOUND", async () => {
  const throwingStore: LifecycleAggregateStore = {
    async loadState() {
      return { state: "pending", version: 1, occurredAt: "2026-09-01T00:00:00.000Z" };
    },
    async saveState() {
      throw new Error("connection reset");
    },
  };

  await assert.rejects(
    () =>
      dispatchLifecycleEvent(
        "link",
        "link-1",
        {
          eventId: "e1",
          targetState: "active",
          version: 2,
          occurredAt: "2026-09-03T00:00:00.000Z",
          payloadHash: "a".repeat(64),
        },
        { stores: { link: throwingStore } },
      ),
    /connection reset/,
  );
});
