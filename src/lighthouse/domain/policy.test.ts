/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";
import {
  DELEGATED_PROHIBITED_SCOPES,
  INVESTSCAPE_ADMIN_SCOPES,
  KNOWN_SCOPES,
  type PolicyRequest,
  authorize,
  isProhibitedDelegatedScope,
} from "./policy.ts";
import type { ResolvedOperatingContext } from "./operatingContext.ts";

const FLAG = "lighthouse.delegated_portfolio_management";

const delegatedContext: ResolvedOperatingContext = {
  kind: "delegated_client",
  actorId: "pro-1",
  subjectId: "client-1",
  authority: { kind: "delegation_mandate", grantId: "mandate-1" },
  scopes: ["delegated.portfolio.view"],
  relationshipRef: "rel-1",
  correlationId: "corr-1",
};

function baseRequest(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    featureFlag: FLAG,
    context: delegatedContext,
    requiredScopes: ["delegated.portfolio.view"],
    requiredAuthority: "delegation_mandate",
    permittedContexts: ["delegated_client"],
    ...overrides,
  };
}

const deps = (enabled: boolean, sink?: InMemoryAuditSink) => ({
  isFeatureEnabled: () => enabled,
  knownScopes: KNOWN_SCOPES,
  auditSink: sink,
});

test("a fully authorized request with the flag enabled is allowed", async () => {
  const decision = await authorize(baseRequest(), deps(true));
  assert.equal(decision.allowed, true);
});

test("the same request is denied when the flag is disabled", async () => {
  const decision = await authorize(baseRequest(), deps(false));
  assert.deepEqual(decision, { allowed: false, reason: "FEATURE_FLAG_DISABLED" });
});

test("an enabled flag never substitutes for authority", async () => {
  // The load-bearing test for "flags must not bypass authorization".
  // Flag ON, but every other pillar removed in turn — all must still deny.
  const withoutScope = await authorize(
    baseRequest({ context: { ...delegatedContext, scopes: [] } }), deps(true));
  assert.deepEqual(withoutScope, { allowed: false, reason: "INSUFFICIENT_SCOPE" });

  const wrongAuthority = await authorize(
    baseRequest({
      context: { ...delegatedContext, authority: { kind: "product_entitlement" } },
    }), deps(true));
  assert.deepEqual(wrongAuthority, { allowed: false, reason: "WRONG_AUTHORITY_KIND" });

  const wrongContext = await authorize(
    baseRequest({ permittedContexts: ["personal"] }), deps(true));
  assert.deepEqual(wrongContext, { allowed: false, reason: "CONTEXT_NOT_PERMITTED" });
});

test("an unknown feature flag fails closed even when the resolver says enabled", async () => {
  const decision = await authorize(
    baseRequest({ featureFlag: "lighthouse.made_up" }), deps(true));
  assert.deepEqual(decision, { allowed: false, reason: "UNKNOWN_FEATURE_FLAG" });
});

test("an unknown scope fails closed", async () => {
  const decision = await authorize(
    baseRequest({
      requiredScopes: ["delegated.invented.scope"],
      context: { ...delegatedContext, scopes: ["delegated.invented.scope"] },
    }), deps(true));
  assert.deepEqual(decision, { allowed: false, reason: "UNKNOWN_SCOPE" });
});

// --- Authority separation (invariant 4) ------------------------------------

test("billing entitlement cannot create delegation, sharing or admin authority", async () => {
  const paid: ResolvedOperatingContext = {
    ...delegatedContext,
    authority: { kind: "product_entitlement", grantId: "sub-1" },
    scopes: [
      "delegated.portfolio.view",
      "share.grant.create",
      "investscape.configuration.manage",
    ],
  };

  for (const required of [
    "delegation_mandate", "share_grant", "admin_assignment",
  ] as const) {
    const decision = await authorize(
      baseRequest({
        context: paid,
        requiredAuthority: required,
        requiredScopes: [],
      }), deps(true));
    assert.deepEqual(
      decision, { allowed: false, reason: "WRONG_AUTHORITY_KIND" },
      `paying must not grant ${required}`,
    );
  }
});

test("a sponsored Stage 1 entitlement does not grant delegated portfolio access", async () => {
  const sponsored: ResolvedOperatingContext = {
    ...delegatedContext,
    kind: "professional_assisted",
    authority: { kind: "sponsored_entitlement", grantId: "ent-1" },
  };
  const decision = await authorize(
    baseRequest({ context: sponsored }), deps(true));
  assert.equal(decision.allowed, false);
});

test("an admin assignment does not grant client portfolio access", async () => {
  const admin: ResolvedOperatingContext = {
    ...delegatedContext,
    authority: { kind: "admin_assignment", grantId: "assign-1" },
  };
  const decision = await authorize(baseRequest({ context: admin }), deps(true));
  assert.deepEqual(decision, { allowed: false, reason: "WRONG_AUTHORITY_KIND" });
});

// --- Purpose ---------------------------------------------------------------

test("a purpose-required operation without a purpose fails closed", async () => {
  const decision = await authorize(
    baseRequest({ requirePurpose: true }), deps(true));
  assert.deepEqual(decision, { allowed: false, reason: "PURPOSE_REQUIRED" });
});

test("a purpose-required operation with a purpose is allowed", async () => {
  const decision = await authorize(
    baseRequest({ requirePurpose: true, purpose: "client_portfolio_review" }),
    deps(true));
  assert.equal(decision.allowed, true);
});

// --- Prohibited delegated powers -------------------------------------------

test("initially prohibited delegated powers are not in the granted scope set", () => {
  for (const scope of DELEGATED_PROHIBITED_SCOPES) {
    assert.ok(isProhibitedDelegatedScope(scope), scope);
    assert.equal(
      KNOWN_SCOPES.has(scope), false,
      `${scope} must not be grantable in v1`,
    );
  }
});

test("payment, export, deletion and onward delegation are all prohibited", () => {
  for (const scope of [
    "delegated.payment.change", "delegated.subscription.purchase",
    "delegated.export.bulk", "delegated.delete.permanent",
    "delegated.ownership.transfer", "delegated.delegation.onward",
    "delegated.auth.change",
  ]) {
    assert.ok(isProhibitedDelegatedScope(scope), scope);
  }
});

test("billing administration is not an InvestScape admin scope", () => {
  const joined = INVESTSCAPE_ADMIN_SCOPES.join(",");
  assert.ok(!joined.includes("billing"), "billing stays a separate authority");
  assert.ok(!joined.includes("invoice"));
});

// --- Audit -----------------------------------------------------------------

test("an allowed decision records a complete audit event", async () => {
  const sink = new InMemoryAuditSink();
  await authorize(
    baseRequest({ purpose: "client_portfolio_review" }), deps(true, sink));

  assert.equal(sink.events.length, 1);
  const event = sink.events[0]!;
  assert.equal(event.actorId, "pro-1");
  assert.equal(event.subjectId, "client-1");
  assert.equal(event.operatingContext, "delegated_client");
  assert.equal(event.authority.kind, "delegation_mandate");
  assert.equal(event.authority.grantId, "mandate-1");
  assert.equal(event.purpose, "client_portfolio_review");
  assert.equal(event.outcome, "allowed");
  assert.equal(event.correlationId, "corr-1");
  assert.ok(event.occurredAt);
});

test("a denial is audited just as thoroughly as an approval", async () => {
  const sink = new InMemoryAuditSink();
  await authorize(baseRequest(), deps(false, sink));

  assert.equal(sink.events.length, 1);
  const event = sink.events[0]!;
  assert.equal(event.outcome, "denied");
  assert.deepEqual(event.metadata, { reason: "FEATURE_FLAG_DISABLED" });
  assert.equal(event.subjectId, "client-1");
});
