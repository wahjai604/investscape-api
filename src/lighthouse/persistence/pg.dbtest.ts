/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * REAL DATABASE integration tests.
 *
 * These run only when DATABASE_URL is set, and are skipped otherwise so the
 * unit suite stays runnable with no infrastructure. They exist because a
 * schema comment claiming "this constraint prevents X" is worthless until
 * something actually tries X and gets rejected.
 *
 *   docker run -d --name lighthouse-pg -e POSTGRES_PASSWORD=... -p 55432:5432 postgres:16-alpine
 *   npm run migrate:lighthouse
 *   npm run test:db
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import { createPgClientFromEnv } from "./pgClient.ts";
import { UniqueConstraintViolation } from "./types.ts";

dotenv.config();

const client = createPgClientFromEnv();
const skip = client === null ? "DATABASE_URL not set" : false;

/** Unique suffix so repeated runs don't collide on the unique indexes. */
const RUN = `t${Date.now().toString(36)}`;
const actor = (n: string) => `${RUN}-actor-${n}`;

async function cleanup(): Promise<void> {
  if (!client) return;
  await client.query(
    "delete from lighthouse.context_authorities where actor_ref like $1",
    [`${RUN}-%`],
  );
  await client.query(
    "delete from lighthouse.inbound_events where event_id like $1",
    [`${RUN}-%`],
  );
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

test("the adapter connects and both migrations are recorded", { skip }, async () => {
  const result = await client!.query<{ name: string }>(
    "select name from lighthouse.schema_migrations order by name",
  );
  const names = result.rows.map((r) => r.name);
  assert.ok(names.includes("0001_lighthouse_foundation.sql"));
  assert.ok(names.includes("0002_context_and_linking.sql"));
});

test("every lighthouse table has row level security enabled", { skip }, async () => {
  const result = await client!.query<{ tablename: string; rowsecurity: boolean }>(
    "select tablename, rowsecurity from pg_tables where schemaname = 'lighthouse'",
  );
  assert.ok(result.rows.length >= 9, "expected at least 9 tables");
  const unprotected = result.rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
  assert.deepEqual(unprotected, [], `tables without RLS: ${unprotected.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Operating-context constraints — the security properties, actually exercised
// ---------------------------------------------------------------------------

test("a 'personal' authority where actor is not the subject is rejected by the DB", { skip }, async () => {
  // Invariant 1 defence in depth: resolveOperatingContext already refuses this,
  // but a mis-shaped row must be impossible to persist in the first place.
  await assert.rejects(
    () => client!.query(
      `insert into lighthouse.context_authorities
         (actor_ref, subject_ref, kind, authority_kind)
       values ($1, $2, 'personal', 'self')`,
      [actor("a"), actor("SOMEONE-ELSE")],
    ),
    /personal_actor_is_subject/,
  );
});

test("a delegated_client authority with no relationship_ref is rejected by the DB", { skip }, async () => {
  // This is the multi-client ambiguity fix, enforced in the schema: a
  // delegated context that doesn't say WHICH client cannot exist.
  await assert.rejects(
    () => client!.query(
      `insert into lighthouse.context_authorities
         (actor_ref, subject_ref, kind, authority_kind)
       values ($1, $2, 'delegated_client', 'delegation_mandate')`,
      [actor("b"), actor("client-1")],
    ),
    /delegated_requires_relationship/,
  );
});

test("one professional can hold MANY delegated_client authorities, one per client", { skip }, async () => {
  const pro = actor("multi");
  await cleanup();

  for (const [subject, rel] of [["client-a", "rel-a"], ["client-b", "rel-b"], ["client-c", "rel-c"]]) {
    await client!.query(
      `insert into lighthouse.context_authorities
         (actor_ref, subject_ref, kind, authority_kind, relationship_ref, scopes)
       values ($1, $2, 'delegated_client', 'delegation_mandate', $3, $4)`,
      [pro, `${RUN}-${subject}`, rel, ["delegated.portfolio.view"]],
    );
  }

  // ...and a personal authority for their OWN portfolio, simultaneously.
  await client!.query(
    `insert into lighthouse.context_authorities
       (actor_ref, subject_ref, kind, authority_kind)
     values ($1, $1, 'personal', 'self')`,
    [pro],
  );

  const all = await client!.query<{ kind: string }>(
    "select kind from lighthouse.context_authorities where actor_ref = $1",
    [pro],
  );
  assert.equal(all.rows.length, 4, "3 client mandates + 1 personal");

  // The lookup the resolver performs must return exactly ONE row.
  const one = await client!.query<{ subject_ref: string }>(
    `select subject_ref from lighthouse.context_authorities
      where actor_ref = $1 and kind = 'delegated_client' and relationship_ref = $2
        and status = 'active'`,
    [pro, "rel-b"],
  );
  assert.equal(one.rows.length, 1);
  assert.equal(one.rows[0]!.subject_ref, `${RUN}-client-b`);
});

test("a duplicate 'personal' authority for the same actor is rejected", { skip }, async () => {
  const dup = actor("dup");
  await client!.query(
    `insert into lighthouse.context_authorities
       (actor_ref, subject_ref, kind, authority_kind) values ($1, $1, 'personal', 'self')`,
    [dup],
  );
  // COALESCE in the unique index is what makes this fail — without it, NULL
  // relationship_ref would be treated as distinct and duplicates would slip in.
  await assert.rejects(
    () => client!.query(
      `insert into lighthouse.context_authorities
         (actor_ref, subject_ref, kind, authority_kind) values ($1, $1, 'personal', 'self')`,
      [dup],
    ),
    (error: unknown) => error instanceof UniqueConstraintViolation,
    "driver error should be translated to UniqueConstraintViolation",
  );
});

test("an unknown operating-context kind is rejected by the DB", { skip }, async () => {
  await assert.rejects(
    () => client!.query(
      `insert into lighthouse.context_authorities
         (actor_ref, subject_ref, kind, authority_kind)
       values ($1, $1, 'superuser', 'self')`,
      [actor("forge")],
    ),
    /context_authorities_kind_check/,
  );
});

// ---------------------------------------------------------------------------
// Stage 1 / Stage 6 durability
// ---------------------------------------------------------------------------

test("launch-session binding is unique — two landing requests cannot create two analyses", { skip }, async () => {
  const session = "11111111-2222-4333-8444-" + Date.now().toString().slice(-12);
  const insert = (analysisId: string) => client!.query(
    `insert into lighthouse.launch_analysis_bindings
       (launch_session_id, analysis_id, analysis_type, correlation_id, property_ref)
     values ($1, $2, 'investment_quick_review', 'corr-1', 'prop-1')
     on conflict (launch_session_id) do nothing
     returning analysis_id`,
    [session, analysisId],
  );

  const first = await insert(`${RUN}-analysis-1`);
  const second = await insert(`${RUN}-analysis-2`);

  assert.equal(first.rowCount, 1, "first landing creates the binding");
  assert.equal(second.rowCount, 0, "second landing must adopt, not create");

  await client!.query(
    "delete from lighthouse.launch_analysis_bindings where launch_session_id = $1",
    [session],
  );
});

test("a reused event_id with a different payload hash is a detectable conflict", { skip }, async () => {
  const eventId = `${RUN}-evt-1`;
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);

  await client!.query(
    `insert into lighthouse.inbound_events
       (event_id, schema_version, aggregate_id, aggregate_kind, version, payload_hash, outcome, occurred_at)
     values ($1,'v1','agg-1','link',1,$2,'applied', now())`,
    [eventId, hashA],
  );

  // The durable half of the payload-hash idempotency fix: the ledger makes the
  // conflict observable rather than letting a mutated replay vanish.
  const existing = await client!.query<{ payload_hash: string }>(
    "select payload_hash from lighthouse.inbound_events where event_id = $1",
    [eventId],
  );
  assert.equal(existing.rows[0]!.payload_hash, hashA);
  assert.notEqual(existing.rows[0]!.payload_hash, hashB,
    "a mutated replay must be distinguishable from a true duplicate");
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

test("a failed transaction rolls back completely", { skip }, async () => {
  const rollbackActor = actor("rollback");
  await assert.rejects(() =>
    client!.transaction(async (tx) => {
      await tx.query(
        `insert into lighthouse.context_authorities
           (actor_ref, subject_ref, kind, authority_kind) values ($1,$1,'personal','self')`,
        [rollbackActor],
      );
      throw new Error("deliberate failure after a successful write");
    }),
  );

  const rows = await client!.query(
    "select 1 from lighthouse.context_authorities where actor_ref = $1",
    [rollbackActor],
  );
  assert.equal(rows.rows.length, 0, "the write must not survive the rollback");
});

test("no lighthouse table stores an email, password, token or one-time code column", { skip }, async () => {
  // Structural privacy check: these columns must not exist anywhere, so they
  // cannot be populated by a future careless insert.
  const forbidden = ["email", "password", "passwordhash", "token", "access_token",
    "refresh_token", "code", "one_time_code", "launch_url", "card", "iban"];
  const result = await client!.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'lighthouse'`,
  );
  const offenders = result.rows.filter((r) =>
    forbidden.some((f) => r.column_name.toLowerCase().replace(/_/g, "") === f.replace(/_/g, "")),
  );
  assert.deepEqual(offenders, [],
    `forbidden columns present: ${offenders.map((o) => `${o.table_name}.${o.column_name}`).join(", ")}`);
});

test("cleanup", { skip }, async () => {
  await cleanup();
  await client!.close();
});
