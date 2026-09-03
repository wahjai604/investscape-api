/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type ContextAuthorityRecord,
  DISABLED_CONTEXT_KINDS,
  contextPartitionKey,
  isKnownOperatingContext,
  resolveOperatingContext,
  sharesPartition,
} from "./operatingContext.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const now = () => NOW;
const allEnabled = () => true;

const PRO = "user-professional-1";
const CLIENT = "user-client-1";

function personalRecord(overrides: Partial<ContextAuthorityRecord> = {}): ContextAuthorityRecord {
  return {
    kind: "personal", actorId: PRO, subjectId: PRO,
    authority: { kind: "self" }, scopes: ["personal.portfolio.read"],
    status: "active", ...overrides,
  };
}

function delegatedRecord(overrides: Partial<ContextAuthorityRecord> = {}): ContextAuthorityRecord {
  return {
    kind: "delegated_client", actorId: PRO, subjectId: CLIENT,
    authority: { kind: "delegation_mandate", grantId: "mandate-1" },
    scopes: ["delegated.portfolio.view"], status: "active",
    relationshipRef: "rel-1", expiresAt: "2026-12-01T00:00:00.000Z",
    ...overrides,
  };
}

function resolve(
  requestedKind: string,
  record: ContextAuthorityRecord | null,
  requestedRelationshipRef?: string,
) {
  return resolveOperatingContext({
    authenticatedActorId: PRO,
    requestedKind,
    // Default to the fixture's own relationshipRef so existing single-client
    // tests don't need updating; multi-client tests pass an explicit ref.
    requestedRelationshipRef:
      requestedRelationshipRef ?? (record?.relationshipRef as string | undefined),
    lookupAuthority: async () => record,
    isContextEnabled: allEnabled,
    now,
    correlationId: "corr-1",
  });
}

test("a valid personal context resolves with the actor as subject", async () => {
  const result = await resolve("personal", personalRecord());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.context.subjectId, PRO);
    assert.equal(result.context.authority.kind, "self");
  }
});

test("a valid delegated context resolves with the CLIENT as subject", async () => {
  const result = await resolve("delegated_client", delegatedRecord());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.context.actorId, PRO, "actor is the professional");
    assert.equal(result.context.subjectId, CLIENT, "subject is the client");
  }
});

// --- Forgery ---------------------------------------------------------------

test("a browser-supplied context with no authority record fails closed", async () => {
  const result = await resolve("delegated_client", null, "rel-1");
  assert.deepEqual(result, { ok: false, reason: "NO_AUTHORITY" });
});

test("delegated_client resolution with NO relationship selector at all is refused", async () => {
  const result = await resolveOperatingContext({
    authenticatedActorId: PRO,
    requestedKind: "delegated_client",
    lookupAuthority: async () => delegatedRecord(),
    isContextEnabled: allEnabled,
    now,
    correlationId: "corr-1",
  });
  assert.deepEqual(result, { ok: false, reason: "RELATIONSHIP_REF_REQUIRED" });
});

test("a professional with multiple clients resolves the requested client, not another", async () => {
  const clientA = delegatedRecord({ subjectId: "client-a", relationshipRef: "rel-a" });
  const clientB = delegatedRecord({ subjectId: "client-b", relationshipRef: "rel-b" });
  const result = await resolveOperatingContext({
    authenticatedActorId: PRO,
    requestedKind: "delegated_client",
    requestedRelationshipRef: "rel-a",
    lookupAuthority: async (actorId, kind, relationshipRef) =>
      relationshipRef === "rel-a" ? clientA : relationshipRef === "rel-b" ? clientB : null,
    isContextEnabled: allEnabled,
    now,
    correlationId: "corr-1",
  });
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.context.subjectId, "client-a");
});

test("a repository that ignores the selector and returns the wrong relationship is refused", async () => {
  // Defence in depth: even if lookupAuthority is buggy and returns SOME
  // record regardless of the selector, resolution must not trust it if the
  // relationshipRef on the record doesn't match what was requested.
  const result = await resolveOperatingContext({
    authenticatedActorId: PRO,
    requestedKind: "delegated_client",
    requestedRelationshipRef: "rel-a",
    lookupAuthority: async () => delegatedRecord({ relationshipRef: "rel-b" }),
    isContextEnabled: allEnabled,
    now,
    correlationId: "corr-1",
  });
  assert.deepEqual(result, { ok: false, reason: "SUBJECT_MISMATCH" });
});

test("an unknown context string fails closed", async () => {
  for (const forged of ["admin", "superuser", "PERSONAL", "", "../organization"]) {
    const result = await resolve(forged, personalRecord());
    assert.deepEqual(result, { ok: false, reason: "UNKNOWN_CONTEXT" }, forged);
  }
});

test("the organization context is reserved and cannot resolve", async () => {
  assert.ok(DISABLED_CONTEXT_KINDS.has("organization"));
  const result = await resolve("organization", {
    ...personalRecord(), kind: "organization",
  });
  assert.deepEqual(result, { ok: false, reason: "CONTEXT_DISABLED" });
});

test("an authority record belonging to another actor is refused", async () => {
  const result = await resolve("delegated_client",
    delegatedRecord({ actorId: "someone-else" }));
  assert.deepEqual(result, { ok: false, reason: "SUBJECT_MISMATCH" });
});

test("personal context where actor is not the subject is refused", async () => {
  // A mis-shaped record must not silently grant access to another person's data.
  const result = await resolve("personal", personalRecord({ subjectId: CLIENT }));
  assert.deepEqual(result, { ok: false, reason: "SUBJECT_MISMATCH" });
});

// --- Lifecycle -------------------------------------------------------------

test("suspended, expired and revoked mandates all fail closed", async () => {
  for (const status of ["suspended", "expired", "revoked"] as const) {
    const result = await resolve("delegated_client", delegatedRecord({ status }));
    assert.deepEqual(result, { ok: false, reason: "AUTHORITY_NOT_ACTIVE" }, status);
  }
});

test("an expired mandate fails even when its status still says active", async () => {
  // Stale status labels must not outrank the clock.
  const result = await resolve("delegated_client",
    delegatedRecord({ expiresAt: "2026-08-01T00:00:00.000Z" }));
  assert.deepEqual(result, { ok: false, reason: "AUTHORITY_EXPIRED" });
});

test("a not-yet-effective mandate fails closed", async () => {
  const result = await resolve("delegated_client",
    delegatedRecord({ effectiveFrom: "2026-10-01T00:00:00.000Z" }));
  assert.deepEqual(result, { ok: false, reason: "AUTHORITY_NOT_ACTIVE" });
});

test("a disabled context feature flag blocks resolution", async () => {
  const result = await resolveOperatingContext({
    authenticatedActorId: PRO,
    requestedKind: "delegated_client",
    lookupAuthority: async () => delegatedRecord(),
    isContextEnabled: () => false,
    now,
    correlationId: "corr-1",
  });
  assert.deepEqual(result, { ok: false, reason: "FEATURE_DISABLED" });
});

// --- Partitioning ----------------------------------------------------------

test("personal and delegated contexts never share a cache partition", async () => {
  const personal = await resolve("personal", personalRecord());
  const delegated = await resolve("delegated_client", delegatedRecord());
  assert.ok(personal.ok && delegated.ok);
  if (personal.ok && delegated.ok) {
    assert.notEqual(
      contextPartitionKey(personal.context),
      contextPartitionKey(delegated.context),
    );
    assert.equal(sharesPartition(personal.context, delegated.context), false);
  }
});

test("two different clients never share a cache partition", async () => {
  const a = await resolve("delegated_client", delegatedRecord({ subjectId: "client-a" }));
  const b = await resolve("delegated_client", delegatedRecord({ subjectId: "client-b" }));
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.equal(sharesPartition(a.context, b.context), false);
});

test("the same client under a different relationship is a different partition", async () => {
  const a = await resolve("delegated_client", delegatedRecord({ relationshipRef: "rel-1" }));
  const b = await resolve("delegated_client", delegatedRecord({ relationshipRef: "rel-2" }));
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.equal(sharesPartition(a.context, b.context), false);
});

test("the partition key carries no free-text label that a browser could set", async () => {
  const delegated = await resolve("delegated_client", delegatedRecord());
  assert.ok(delegated.ok);
  if (delegated.ok) {
    const key = contextPartitionKey(delegated.context);
    assert.ok(key.includes(PRO) && key.includes(CLIENT));
    assert.ok(!key.includes("undefined"));
  }
});

test("known-context predicate rejects anything outside the four kinds", () => {
  assert.ok(isKnownOperatingContext("personal"));
  assert.ok(isKnownOperatingContext("professional_assisted"));
  assert.ok(isKnownOperatingContext("delegated_client"));
  assert.ok(isKnownOperatingContext("organization"));
  assert.equal(isKnownOperatingContext("client"), false);
  assert.equal(isKnownOperatingContext("admin"), false);
});
