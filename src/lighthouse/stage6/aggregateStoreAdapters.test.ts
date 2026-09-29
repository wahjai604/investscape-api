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
  createShareGrantAggregateStore,
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
  /** Every statement, in order, with whether it ran inside transaction(). */
  readonly log: { sql: string; params: readonly unknown[]; inTransaction: boolean }[] = [];
  /** share_grant_id -> { linkId, clientUserRef, state } */
  readonly grants = new Map<string, { linkId: string; clientUserRef: string; state: string }>();
  transactions = 0;
  #inTransaction = false;

  async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    this.transactions += 1;
    this.#inTransaction = true;
    try {
      return await fn(this);
    } finally {
      this.#inTransaction = false;
    }
  }

  async query<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<SqlQueryResult<TRow>> {
    const normalized = sql.trim().toLowerCase();
    this.log.push({ sql: normalized.replace(/\s+/g, " "), params, inTransaction: this.#inTransaction });

    if (normalized.startsWith("update lighthouse.share_grants")) {
      const [linkId, clientUserRef] = params as [string, string];
      const revoked: { share_grant_id: string }[] = [];
      for (const [id, g] of this.grants) {
        if (g.linkId === linkId && g.clientUserRef === clientUserRef && g.state === "active") {
          g.state = "revoked";
          revoked.push({ share_grant_id: id });
        }
      }
      return { rows: revoked as unknown as TRow[], rowCount: revoked.length };
    }

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
        // The link store asks for the owning actor back; others ignore it.
        return { rows: [{ investscape_actor_ref: "actor-owner" } as unknown as TRow], rowCount: 1 };
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

// ---------------------------------------------------------------------------
// Inbound Relationship OS unlink: same atomic link -> grant cascade as the
// user-initiated path (stage2 revokeLink). Both call revokeDependentShareGrants.
// ---------------------------------------------------------------------------

test("an inbound link revocation revokes the link's active grants in the SAME transaction", async () => {
  const client = new FakeSqlClient();
  client.rows.set("link-1", { state: "active", version: 2, occurred_at: "2026-09-01T00:00:00.000Z" });
  client.grants.set("g-live", { linkId: "link-1", clientUserRef: "actor-owner", state: "active" });
  client.grants.set("g-already-revoked", { linkId: "link-1", clientUserRef: "actor-owner", state: "revoked" });
  client.grants.set("g-other-link", { linkId: "link-2", clientUserRef: "actor-owner", state: "active" });
  client.grants.set("g-other-owner", { linkId: "link-1", clientUserRef: "someone-else", state: "active" });

  const result = await dispatchLifecycleEvent(
    "link",
    "link-1",
    { eventId: "evt-unlink-1", targetState: "revoked", version: 3, occurredAt: "2026-09-02T00:00:00.000Z" },
    { stores: { link: createLinkAggregateStore(client) } },
  );

  assert.equal(result.ok, true);
  assert.equal(client.rows.get("link-1")?.state, "revoked");
  assert.equal(client.grants.get("g-live")?.state, "revoked");
  assert.equal(client.grants.get("g-already-revoked")?.state, "revoked");
  assert.equal(client.grants.get("g-other-link")?.state, "active", "another link's grant is untouched");
  assert.equal(client.grants.get("g-other-owner")?.state, "active", "only the link owner's grants move");

  assert.equal(client.transactions, 1);
  const writes = client.log.filter((q) => q.sql.startsWith("update"));
  assert.equal(writes.length, 2);
  assert.ok(writes.every((q) => q.inTransaction), "link and grant writes must share one transaction");
  assert.match(writes[0]!.sql, /revoked_at = coalesce\(revoked_at, \$3\)/, "satisfies link_terminal_has_timestamp");
});

test("an inbound link suspension does NOT revoke grants (reads are blocked by the live link check instead)", async () => {
  const client = new FakeSqlClient();
  client.rows.set("link-1", { state: "active", version: 2, occurred_at: "2026-09-01T00:00:00.000Z" });
  client.grants.set("g-live", { linkId: "link-1", clientUserRef: "actor-owner", state: "active" });

  await dispatchLifecycleEvent(
    "link",
    "link-1",
    { eventId: "evt-suspend-1", targetState: "suspended", version: 3, occurredAt: "2026-09-02T00:00:00.000Z" },
    { stores: { link: createLinkAggregateStore(client) } },
  );
  assert.equal(client.rows.get("link-1")?.state, "suspended");
  assert.equal(client.grants.get("g-live")?.state, "active");
});

test("a stale inbound link revocation changes nothing — neither link nor grants", async () => {
  const client = new FakeSqlClient();
  client.rows.set("link-1", { state: "active", version: 5, occurred_at: "2026-09-01T00:00:00.000Z" });
  client.grants.set("g-live", { linkId: "link-1", clientUserRef: "actor-owner", state: "active" });

  await createLinkAggregateStore(client).saveState("link-1", {
    state: "revoked", version: 4, occurredAt: "2026-09-02T00:00:00.000Z",
  });
  assert.equal(client.rows.get("link-1")?.state, "active");
  assert.equal(client.grants.get("g-live")?.state, "active");
});

test("inbound revocations of any aggregate set revoked_at (terminal-timestamp constraints)", async () => {
  const client = new FakeSqlClient();
  client.rows.set("grant-1", { state: "active", version: 1, occurred_at: "2026-09-01T00:00:00.000Z" });
  await createShareGrantAggregateStore(client).saveState("grant-1", {
    state: "revoked", version: 2, occurredAt: "2026-09-02T00:00:00.000Z",
  });
  const write = client.log.find((q) => q.sql.startsWith("update lighthouse.share_grants"));
  assert.ok(write);
  assert.match(write.sql, /revoked_at = coalesce\(revoked_at, \$3\)/);
});
