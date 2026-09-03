/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 7 domain tests — admin assignment: bootstrap, escalation guard,
 * revocation authorization, lifecycle.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveScopesFor,
  createAdminAssignment,
  assignmentPermits,
  authorizeRevocation,
  ADMIN_MANAGEMENT_SCOPE,
  type AdminAssignment,
} from "./adminAssignment.ts";
import { INVESTSCAPE_ADMIN_SCOPES } from "./policy.ts";

const NOW = new Date("2026-09-03T12:00:00.000Z");

function baseInput(overrides: Partial<Parameters<typeof createAdminAssignment>[0]> = {}) {
  return {
    assignmentId: "a1",
    granterActorRef: "granter-1",
    granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
    granteeActorRef: "grantee-1",
    requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
    purpose: "onboarding a second admin",
    expiresAt: null,
    now: NOW,
    correlationId: "corr-1",
    isEnabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

test("the seed actor holds every known admin scope, with no stored scopes", () => {
  const scopes = effectiveScopesFor("seed-actor", "seed-actor", []);
  assert.deepEqual([...scopes].sort(), [...INVESTSCAPE_ADMIN_SCOPES].sort());
});

test("an actor who is NOT the seed gets only their stored scopes", () => {
  const scopes = effectiveScopesFor("someone-else", "seed-actor", ["investscape.incident.review"]);
  assert.deepEqual(scopes, ["investscape.incident.review"]);
});

test("an unset seed ref never grants anyone bootstrap authority", () => {
  const scopes = effectiveScopesFor("anyone", undefined, []);
  assert.deepEqual(scopes, []);
});

test("the seed actor can grant the first real assignment", () => {
  const result = createAdminAssignment(
    baseInput({
      granterActorRef: "seed-actor",
      granterEffectiveScopes: effectiveScopesFor("seed-actor", "seed-actor", []),
      requestedScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review"],
    }),
  );
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

test("disabled feature refuses regardless of authority", () => {
  const result = createAdminAssignment(baseInput({ isEnabled: false }));
  assert.deepEqual(result, { ok: false, reason: "FEATURE_DISABLED" });
});

// ---------------------------------------------------------------------------
// Granter authorization
// ---------------------------------------------------------------------------

test("a granter without the management scope cannot grant anything, even scopes they hold", () => {
  const result = createAdminAssignment(
    baseInput({
      granterEffectiveScopes: ["investscape.incident.review"],
      requestedScopes: ["investscape.incident.review"],
    }),
  );
  assert.deepEqual(result, { ok: false, reason: "GRANTER_NOT_AUTHORIZED" });
});

// ---------------------------------------------------------------------------
// THE escalation guard
// ---------------------------------------------------------------------------

test("a granter cannot grant a scope they do not themselves hold", () => {
  const result = createAdminAssignment(
    baseInput({
      granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review"],
      requestedScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.retention.manage"],
    }),
  );
  assert.deepEqual(result, { ok: false, reason: "SCOPE_EXCEEDS_GRANTER_AUTHORITY" });
});

test("a granter CAN grant a subset of scopes they hold", () => {
  const result = createAdminAssignment(
    baseInput({
      granterEffectiveScopes: [
        ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review", "investscape.retention.manage",
      ],
      requestedScopes: ["investscape.incident.review"],
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.assignment.scopes, ["investscape.incident.review"]);
});

test("a self-grant can never exceed the granter's own existing scopes", () => {
  // Granter grants to THEMSELVES. Even so, requesting a scope beyond what
  // they hold is refused exactly like granting to someone else would be —
  // there is no separate "self" code path that skips the check.
  const result = createAdminAssignment(
    baseInput({
      granterActorRef: "actor-x",
      granteeActorRef: "actor-x",
      granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
      requestedScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.privacy_request.manage"],
    }),
  );
  assert.deepEqual(result, { ok: false, reason: "SCOPE_EXCEEDS_GRANTER_AUTHORITY" });
});

test("an unknown scope is rejected even if it looks plausible", () => {
  const result = createAdminAssignment(
    baseInput({
      granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.made_up.scope"],
      requestedScopes: ["investscape.made_up.scope"],
    }),
  );
  assert.deepEqual(result, { ok: false, reason: "UNKNOWN_SCOPE_REQUESTED" });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("no scopes requested is refused", () => {
  const result = createAdminAssignment(baseInput({ requestedScopes: [] }));
  assert.deepEqual(result, { ok: false, reason: "NO_SCOPES_REQUESTED" });
});

test("a missing purpose is refused", () => {
  const result = createAdminAssignment(baseInput({ purpose: "  " }));
  assert.deepEqual(result, { ok: false, reason: "PURPOSE_REQUIRED" });
});

test("an expiry already in the past is refused", () => {
  const result = createAdminAssignment(
    baseInput({ expiresAt: new Date(NOW.getTime() - 1000).toISOString() }),
  );
  assert.deepEqual(result, { ok: false, reason: "EXPIRY_IN_PAST" });
});

// ---------------------------------------------------------------------------
// assignmentPermits
// ---------------------------------------------------------------------------

function activeAssignment(overrides: Partial<AdminAssignment> = {}): AdminAssignment {
  return {
    assignmentId: "a1",
    granteeActorRef: "grantee-1",
    grantedByActorRef: "granter-1",
    scopes: ["investscape.incident.review"],
    purpose: "test",
    effectiveFrom: NOW.toISOString(),
    expiresAt: null,
    correlationId: "corr-1",
    lifecycle: { state: "active", version: 1, occurredAt: NOW.toISOString(), appliedEventIds: [] },
    ...overrides,
  };
}

test("an active, unexpired assignment permits its own scope", () => {
  assert.equal(assignmentPermits(activeAssignment(), "investscape.incident.review", NOW), true);
});

test("a scope not on the assignment is not permitted", () => {
  assert.equal(assignmentPermits(activeAssignment(), "investscape.retention.manage", NOW), false);
});

test("a revoked assignment permits nothing", () => {
  const revoked = activeAssignment({
    lifecycle: { state: "revoked", version: 2, occurredAt: NOW.toISOString(), appliedEventIds: [] },
  });
  assert.equal(assignmentPermits(revoked, "investscape.incident.review", NOW), false);
});

test("an expired assignment permits nothing even while lifecycle state still reads active", () => {
  const expired = activeAssignment({
    expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
  });
  assert.equal(assignmentPermits(expired, "investscape.incident.review", NOW), false);
});

test("an assignment not yet effective permits nothing", () => {
  const future = activeAssignment({
    effectiveFrom: new Date(NOW.getTime() + 1000).toISOString(),
  });
  assert.equal(assignmentPermits(future, "investscape.incident.review", NOW), false);
});

// ---------------------------------------------------------------------------
// authorizeRevocation
// ---------------------------------------------------------------------------

test("revocation requires the management scope", () => {
  const result = authorizeRevocation(activeAssignment(), ["investscape.incident.review"], true, 1);
  assert.deepEqual(result, { ok: false, reason: "REVOKER_NOT_AUTHORIZED" });
});

test("revocation is refused while the feature is disabled, even for an authorized revoker", () => {
  const result = authorizeRevocation(activeAssignment(), [ADMIN_MANAGEMENT_SCOPE], false, 1);
  assert.deepEqual(result, { ok: false, reason: "FEATURE_DISABLED" });
});

test("an already-revoked assignment cannot be revoked again", () => {
  const revoked = activeAssignment({
    lifecycle: { state: "revoked", version: 2, occurredAt: NOW.toISOString(), appliedEventIds: [] },
  });
  const result = authorizeRevocation(revoked, [ADMIN_MANAGEMENT_SCOPE], true, 1);
  assert.deepEqual(result, { ok: false, reason: "ASSIGNMENT_NOT_ACTIVE" });
});

test("an authorized revoker with an active assignment is permitted when other holders remain", () => {
  const result = authorizeRevocation(
    activeAssignment({ scopes: [ADMIN_MANAGEMENT_SCOPE] }),
    [ADMIN_MANAGEMENT_SCOPE],
    true,
    1,
  );
  assert.deepEqual(result, { ok: true });
});

// ---------------------------------------------------------------------------
// Last-admin lockout guard
// ---------------------------------------------------------------------------

test("revoking the last holder of the management scope is refused", () => {
  const lastAdmin = activeAssignment({ scopes: [ADMIN_MANAGEMENT_SCOPE] });
  const result = authorizeRevocation(lastAdmin, [ADMIN_MANAGEMENT_SCOPE], true, 0);
  assert.deepEqual(result, { ok: false, reason: "LAST_ADMIN_LOCKOUT" });
});

test("revoking a management-holder is fine when another holder remains", () => {
  const admin = activeAssignment({ scopes: [ADMIN_MANAGEMENT_SCOPE] });
  const result = authorizeRevocation(admin, [ADMIN_MANAGEMENT_SCOPE], true, 1);
  assert.deepEqual(result, { ok: true });
});

test("the lockout guard never fires for an assignment that doesn't hold the management scope", () => {
  // Revoking a scope-limited (e.g. incident-review-only) assignment can never
  // cause a lockout, regardless of how many management holders remain — the
  // zero-holder count here would trip the guard if it applied indiscriminately.
  const limited = activeAssignment({ scopes: ["investscape.incident.review"] });
  const result = authorizeRevocation(limited, [ADMIN_MANAGEMENT_SCOPE], true, 0);
  assert.deepEqual(result, { ok: true });
});
