/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * Stages 2-8 foundation tests.
 * Covers the "Required test coverage" list in the Stages 2-8 foundation prompt.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FORBIDDEN_CROSS_PRODUCT_FIELDS, validateCrossProductMessage,
} from "../contracts/crossProduct.ts";
import {
  ADMIN_ASSIGNMENT_LIFECYCLE, LINK_LIFECYCLE, MANDATE_LIFECYCLE,
  SHARE_GRANT_LIFECYCLE, applyLifecycleEvent, initialSnapshot, replayLifecycle,
} from "./lifecycle.ts";
import {
  LINK_GRANTS, acceptLinkInvitation, generateChallenge, hashChallenge,
  resolveLinkByEmail, unlink, type LinkInvitation,
} from "./crossProductLink.ts";
import {
  authorizeSharedRead, createShareGrant, grantPermitsAnalysis,
  projectSharedSummary, tombstonesForDeletedAnalysis, type ShareGrant,
} from "./shareGrant.ts";
import {
  STATUS_NOT_SHARED, buildProfessionalProjection, enumerateClientAnalyses,
  projectResultReferences,
} from "./connectionProjection.ts";
import {
  acceptDelegationMandate, createDelegationRequest, generateMandateChallenge,
  hashMandateChallenge, mandatePermits, type DelegationMandate, type DelegationRequest,
} from "./delegationMandate.ts";
import { KNOWN_SCOPES } from "./policy.ts";
import {
  DisabledEntitlementSyncAdapter, entitlementGrantsPortfolioAuthority,
  entitlementIsUsable, hasFeature, ingestEntitlementProjection, resolveCheckoutPrompt,
  type StoredEntitlement,
} from "../entitlement/entitlementConsumer.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const PRO = "user-pro-1";
const CLIENT = "user-client-1";

// ===========================================================================
// Stage 2 — cross-product identity linking
// ===========================================================================

const CHALLENGE = generateChallenge();

function invitation(overrides: Partial<LinkInvitation> = {}): LinkInvitation {
  return {
    invitationId: "inv-1",
    challengeHash: hashChallenge(CHALLENGE),
    relationshipOsPersonRef: "ros-person-1",
    relationshipRef: "rel-1",
    expiresAt: "2026-09-01T12:15:00.000Z",
    noticeVersion: "notice-v1",
    correlationId: "corr-1",
    consumedAt: null,
    ...overrides,
  };
}

const goodProof = {
  investscapeUserRef: CLIENT,
  investscapeUserAuthenticated: true,
  relationshipOsPersonRef: "ros-person-1",
  relationshipOsPersonAuthenticated: true,
};

function accept(overrides: Record<string, unknown> = {}) {
  return acceptLinkInvitation({
    invitation: invitation(),
    presentedChallenge: CHALLENGE,
    proof: goodProof,
    now: NOW,
    newLinkId: () => "link-1",
    correlationId: "corr-1",
    isEnabled: true,
    ...overrides,
  } as Parameters<typeof acceptLinkInvitation>[0]);
}

test("dual authenticated acceptance creates a link", () => {
  const result = accept();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.link.investscapeUserRef, CLIENT);
    assert.equal(result.link.lifecycle.state, "active");
    assert.equal(result.link.noticeVersion, "notice-v1");
  }
});

test("linking by email alone is impossible", () => {
  assert.deepEqual(resolveLinkByEmail("client@example.com"), {
    ok: false, reason: "EMAIL_IS_NOT_IDENTITY",
  });
  // Structural: no linking type carries an email field.
  const proofKeys = Object.keys(goodProof).join(",").toLowerCase();
  assert.ok(!proofKeys.includes("email"));
  const invitationKeys = Object.keys(invitation()).join(",").toLowerCase();
  assert.ok(!invitationKeys.includes("email"));
});

test("acceptance fails when the InvestScape user is not authenticated", () => {
  const result = accept({
    proof: { ...goodProof, investscapeUserAuthenticated: false },
  });
  assert.deepEqual(result, { ok: false, reason: "INVESTSCAPE_USER_NOT_AUTHENTICATED" });
});

test("acceptance fails when the Relationship OS person is not authenticated", () => {
  const result = accept({
    proof: { ...goodProof, relationshipOsPersonAuthenticated: false },
  });
  assert.deepEqual(result, { ok: false, reason: "RELATIONSHIP_OS_PERSON_NOT_AUTHENTICATED" });
});

test("a different Relationship OS person cannot redeem the invitation", () => {
  const result = accept({
    proof: { ...goodProof, relationshipOsPersonRef: "ros-person-999" },
  });
  assert.equal(result.ok, false);
});

test("an expired invitation fails closed", () => {
  const result = accept({
    invitation: invitation({ expiresAt: "2026-09-01T11:00:00.000Z" }),
  });
  assert.deepEqual(result, { ok: false, reason: "INVITATION_EXPIRED" });
});

test("a consumed invitation cannot be replayed", () => {
  const result = accept({
    invitation: invitation({ consumedAt: "2026-09-01T11:59:00.000Z" }),
  });
  assert.deepEqual(result, { ok: false, reason: "INVITATION_ALREADY_CONSUMED" });
});

test("a wrong challenge fails closed", () => {
  const result = accept({ presentedChallenge: generateChallenge() });
  assert.deepEqual(result, { ok: false, reason: "CHALLENGE_MISMATCH" });
});

test("concurrent acceptance yields exactly one link", () => {
  // Models the DB guard: the first acceptance marks consumedAt; the second
  // observes it. Only one can win.
  let stored = invitation();
  const attempt = () => {
    const result = accept({ invitation: stored });
    if (result.ok) stored = { ...stored, consumedAt: NOW.toISOString() };
    return result;
  };
  const results = [attempt(), attempt(), attempt()];
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test("the link is disabled when the feature flag is off", () => {
  assert.deepEqual(accept({ isEnabled: false }), { ok: false, reason: "FEATURE_DISABLED" });
});

test("a confirmed link grants nothing at all", () => {
  assert.deepEqual(LINK_GRANTS, [],
    "a link must confer no analysis access, subscription, delegation or sharing");
});

test("unlink revokes every active share grant and leaves a tombstone", () => {
  const result = accept();
  assert.ok(result.ok);
  if (!result.ok) return;
  const { tombstone, shareGrantsToRevoke } = unlink(
    result.link, ["grant-1", "grant-2"], NOW);
  assert.deepEqual(shareGrantsToRevoke, ["grant-1", "grant-2"]);
  assert.equal(tombstone.reason, "unlinked");
  // A tombstone carries no personal data.
  const serialised = JSON.stringify(tombstone).toLowerCase();
  assert.ok(!serialised.includes("email") && !serialised.includes("@"));
});

// ===========================================================================
// Stage 3 / 5 — projections
// ===========================================================================

test("without disclosure consent the status is 'not shared', never 'no subscription'", () => {
  const projection = buildProfessionalProjection({
    linkState: "active",
    workspaceDisclosureConsented: false,
    sharedResultCount: 0,
    isProjectionEnabled: true,
  });
  assert.equal(projection.statusLabel, STATUS_NOT_SHARED);
  assert.equal(projection.workspaceAvailability, "unknown");
  assert.ok(!/no subscription|unsubscribed|not paid/i.test(projection.statusLabel));
});

test("the professional projection exposes only four fields", () => {
  const projection = buildProfessionalProjection({
    linkState: "active",
    workspaceDisclosureConsented: true,
    workspaceIsAvailable: true,
    sharedResultCount: 3,
    isProjectionEnabled: true,
  });
  assert.deepEqual(Object.keys(projection).sort(), [
    "connectionState", "sharedResultCount", "statusLabel", "workspaceAvailability",
  ]);
});

test("client billing details can never enter the professional projection", () => {
  const projection = buildProfessionalProjection({
    linkState: "active",
    workspaceDisclosureConsented: true,
    workspaceIsAvailable: true,
    sharedResultCount: 2,
    isProjectionEnabled: true,
  });
  const serialised = JSON.stringify(projection).toLowerCase();
  for (const forbidden of FORBIDDEN_CROSS_PRODUCT_FIELDS) {
    assert.ok(!serialised.includes(forbidden.toLowerCase()), `${forbidden} leaked`);
  }
});

test("linked without sharing reveals no analyses", () => {
  const projection = buildProfessionalProjection({
    linkState: "active",
    workspaceDisclosureConsented: false,
    sharedResultCount: 0,
    isProjectionEnabled: true,
  });
  assert.equal(projection.connectionState, "connected");
  assert.equal(projection.sharedResultCount, 0);
});

test("a revoked connection reveals no shared counts", () => {
  const projection = buildProfessionalProjection({
    linkState: "revoked",
    workspaceDisclosureConsented: true,
    workspaceIsAvailable: true,
    sharedResultCount: 7,
    isProjectionEnabled: true,
  });
  assert.equal(projection.connectionState, "revoked");
  assert.equal(projection.sharedResultCount, 0);
});

test("a disabled projection flag yields an unavailable, empty projection", () => {
  const projection = buildProfessionalProjection({
    linkState: "active",
    workspaceDisclosureConsented: true,
    workspaceIsAvailable: true,
    sharedResultCount: 5,
    isProjectionEnabled: false,
  });
  assert.equal(projection.connectionState, "unavailable");
  assert.equal(projection.sharedResultCount, 0);
});

test("personal portfolios never appear in a professional projection", () => {
  const projected = projectResultReferences([
    { externalAnalysisId: "a-personal", provenance: "personal", status: "complete",
      summary: { grade: "A" }, relationshipRef: "rel-1" },
    { externalAnalysisId: "a-shared", provenance: "client_shared", status: "complete",
      summary: { grade: "B" }, relationshipRef: "rel-1" },
    { externalAnalysisId: "a-sponsored", provenance: "professional_assisted",
      status: "draft", summary: {}, relationshipRef: "rel-1" },
  ], "rel-1");

  const ids = projected.map((p) => p.externalAnalysisId);
  assert.ok(!ids.includes("a-personal"), "personal portfolio leaked into projection");
  assert.deepEqual(ids.sort(), ["a-shared", "a-sponsored"]);
});

test("results from another relationship are excluded", () => {
  const projected = projectResultReferences([
    { externalAnalysisId: "a1", provenance: "client_shared", status: "complete",
      summary: {}, relationshipRef: "rel-OTHER" },
  ], "rel-1");
  assert.equal(projected.length, 0);
});

test("sponsored and client-shared results are labelled distinctly", () => {
  const projected = projectResultReferences([
    { externalAnalysisId: "a1", provenance: "client_shared", status: "complete",
      summary: {}, relationshipRef: "rel-1" },
    { externalAnalysisId: "a2", provenance: "professional_assisted", status: "complete",
      summary: {}, relationshipRef: "rel-1" },
  ], "rel-1");
  const labels = projected.map((p) => p.provenanceLabel);
  assert.equal(new Set(labels).size, 2, "provenance must be visually distinguishable");
  assert.ok(labels.includes("Shared by client"));
});

test("there is no way to enumerate a client's analyses", () => {
  assert.throws(() => enumerateClientAnalyses(), /ENUMERATION_PROHIBITED/);
});

// ===========================================================================
// Stage 4 — client-selected sharing
// ===========================================================================

function shareInput(overrides: Record<string, unknown> = {}) {
  return {
    shareGrantId: "grant-1",
    crossProductLinkId: "link-1",
    linkIsActive: true,
    clientUserRef: CLIENT,
    authenticatedUserRef: CLIENT,
    destinationRelationshipRef: "rel-1",
    recipientContext: "professional",
    selectedAnalysisIds: ["analysis-1"],
    selectedFields: ["grade", "primaryRisk"],
    purpose: "mortgage_review",
    expiresAt: null,
    noticeVersion: "share-notice-v1",
    consentAffirmed: true,
    now: NOW,
    correlationId: "corr-1",
    isEnabled: true,
    ...overrides,
  } as Parameters<typeof createShareGrant>[0];
}

test("a valid share grant records a complete consent receipt", () => {
  const result = createShareGrant(shareInput());
  assert.ok(result.ok);
  if (!result.ok) return;
  const { consent } = result.grant;
  assert.equal(consent.noticeVersion, "share-notice-v1");
  assert.equal(consent.affirmedByUserRef, CLIENT);
  assert.equal(consent.purpose, "mortgage_review");
  assert.deepEqual(consent.selectedFields, ["grade", "primaryRisk"]);
  assert.equal(consent.destinationRelationshipRef, "rel-1");
});

test("a professional cannot create a share grant over a client's analyses", () => {
  const result = createShareGrant(shareInput({ authenticatedUserRef: PRO }));
  assert.deepEqual(result, { ok: false, reason: "CONSENT_ACTOR_MISMATCH" });
});

test("sharing requires an active link — linking is separate from sharing", () => {
  const result = createShareGrant(shareInput({ linkIsActive: false }));
  assert.deepEqual(result, { ok: false, reason: "LINK_NOT_ACTIVE" });
});

test("consent must be affirmative", () => {
  const result = createShareGrant(shareInput({ consentAffirmed: false }));
  assert.deepEqual(result, { ok: false, reason: "CONSENT_NOT_AFFIRMED" });
});

test("a purpose is required", () => {
  assert.equal(createShareGrant(shareInput({ purpose: "   " })).ok, false);
});

test("an unknown field cannot be shared", () => {
  const result = createShareGrant(shareInput({
    selectedFields: ["grade", "rawWorksheet"],
  }));
  assert.deepEqual(result, { ok: false, reason: "UNKNOWN_FIELD" });
});

test("at least one field and one analysis must be selected", () => {
  assert.equal(createShareGrant(shareInput({ selectedFields: [] })).ok, false);
  assert.equal(createShareGrant(shareInput({ selectedAnalysisIds: [] })).ok, false);
});

test("the analysis count per grant is bounded", () => {
  const many = Array.from({ length: 51 }, (_, i) => `a-${i}`);
  const result = createShareGrant(shareInput({ selectedAnalysisIds: many }));
  assert.deepEqual(result, { ok: false, reason: "TOO_MANY_ANALYSES" });
});

test("an expiry in the past is refused", () => {
  const result = createShareGrant(shareInput({ expiresAt: "2026-08-01T00:00:00.000Z" }));
  assert.deepEqual(result, { ok: false, reason: "EXPIRY_IN_PAST" });
});

test("unselected fields are discarded from the projection", () => {
  const result = createShareGrant(shareInput());
  assert.ok(result.ok);
  if (!result.ok) return;

  const projected = projectSharedSummary(result.grant, {
    grade: "B+",
    primaryRisk: "Rate exposure",
    primaryOpportunity: "NOT SELECTED — must not appear",
    status: "complete",
    rawWorksheet: "secret",
    clientNotes: "private",
  });

  assert.deepEqual(Object.keys(projected).sort(), ["grade", "primaryRisk"]);
  const serialised = JSON.stringify(projected);
  assert.ok(!serialised.includes("NOT SELECTED"));
  assert.ok(!serialised.includes("secret") && !serialised.includes("private"));
});

test("a share grant for the wrong relationship is refused", () => {
  const result = createShareGrant(shareInput());
  assert.ok(result.ok);
  if (!result.ok) return;
  const denied = authorizeSharedRead(result.grant, {
    externalAnalysisId: "analysis-1",
    relationshipRef: "rel-OTHER",
    recipientContext: "professional",
  }, NOW);
  assert.deepEqual(denied, { ok: false, reason: "WRONG_RELATIONSHIP" });
});

test("an unshared analysis is refused even under a valid grant", () => {
  const result = createShareGrant(shareInput());
  assert.ok(result.ok);
  if (!result.ok) return;
  const denied = authorizeSharedRead(result.grant, {
    externalAnalysisId: "analysis-NOT-SHARED",
    relationshipRef: "rel-1",
    recipientContext: "professional",
  }, NOW);
  assert.deepEqual(denied, { ok: false, reason: "NOT_SHARED" });
});

test("an expired grant stops permitting reads", () => {
  const result = createShareGrant(shareInput({
    expiresAt: "2026-09-01T12:30:00.000Z",
  }));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(grantPermitsAnalysis(result.grant, "analysis-1", NOW), true);
  assert.equal(
    grantPermitsAnalysis(result.grant, "analysis-1", new Date("2026-09-02T00:00:00Z")),
    false,
  );
});

test("deleting an analysis produces a tombstone for each active grant", () => {
  const a = createShareGrant(shareInput({ shareGrantId: "g1" }));
  const b = createShareGrant(shareInput({ shareGrantId: "g2" }));
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;

  const revoked: ShareGrant = {
    ...b.grant,
    lifecycle: { ...b.grant.lifecycle, state: "revoked" },
  };
  const tombstones = tombstonesForDeletedAnalysis([a.grant, revoked], "analysis-1");
  assert.deepEqual(tombstones, ["g1"], "only active grants need a tombstone");
});

// ===========================================================================
// Stage 6 — lifecycle, duplicates, out-of-order
// ===========================================================================

test("a duplicate event is an idempotent no-op", () => {
  let snapshot = initialSnapshot(LINK_LIFECYCLE, NOW.toISOString());
  const event = {
    eventId: "e1", targetState: "active" as const,
    version: 1, occurredAt: "2026-09-01T12:00:01.000Z",
  };
  const first = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, event);
  assert.equal(first.kind, "applied");
  if (first.kind === "applied") snapshot = first.snapshot;

  const second = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, event);
  assert.equal(second.kind, "duplicate");
  assert.equal(second.snapshot.state, "active");
});

// --- Payload-hash idempotency defect (2026-09-02 architecture review, P0) --
//
// CONFIRMED DEFECT: idempotency keyed on eventId alone meant a reused eventId
// with ALTERED bytes was previously treated as an ordinary duplicate and
// silently dropped — no error, no quarantine, no audit trail. The caller
// believed a different event had been applied when nothing happened at all.

test("a reused eventId with a matching payloadHash is a true duplicate", () => {
  let snapshot = initialSnapshot(LINK_LIFECYCLE, NOW.toISOString());
  const first = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e1", targetState: "active", version: 1,
    occurredAt: "2026-09-01T12:00:01.000Z", payloadHash: "hash-a",
  });
  assert.equal(first.kind, "applied");
  if (first.kind === "applied") snapshot = first.snapshot;

  const replay = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e1", targetState: "active", version: 1,
    occurredAt: "2026-09-01T12:00:01.000Z", payloadHash: "hash-a",
  });
  assert.equal(replay.kind, "duplicate");
});

test("a reused eventId with a DIFFERENT payloadHash is a conflict, never silently dropped", () => {
  let snapshot = initialSnapshot(LINK_LIFECYCLE, NOW.toISOString());
  const first = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e1", targetState: "active", version: 1,
    occurredAt: "2026-09-01T12:00:01.000Z", payloadHash: "hash-a",
  });
  assert.equal(first.kind, "applied");
  if (first.kind === "applied") snapshot = first.snapshot;

  // Same eventId, mutated bytes (e.g. a different targetState claimed under
  // the same ID). This must NOT be absorbed as a duplicate.
  const mutated = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e1", targetState: "suspended", version: 1,
    occurredAt: "2026-09-01T12:00:01.000Z", payloadHash: "hash-B-DIFFERENT",
  });
  assert.equal(mutated.kind, "conflict");
  if (mutated.kind === "conflict") {
    assert.equal(mutated.reason, "EVENT_ID_PAYLOAD_MISMATCH");
  }
  // State must be unchanged — the conflicting event never applied.
  assert.equal(mutated.snapshot.state, "active");
});

test("callers that never supply payloadHash keep the legacy duplicate behaviour", () => {
  // Backward compatibility: a caller that hasn't adopted payloadHash yet
  // (both hashes undefined) still gets the old "duplicate" outcome rather
  // than being newly blocked by a check it never opted into.
  let snapshot = initialSnapshot(LINK_LIFECYCLE, NOW.toISOString());
  const event = {
    eventId: "e1", targetState: "active" as const,
    version: 1, occurredAt: "2026-09-01T12:00:01.000Z",
  };
  const first = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, event);
  assert.equal(first.kind, "applied");
  if (first.kind === "applied") snapshot = first.snapshot;

  const second = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, event);
  assert.equal(second.kind, "duplicate");
});

test("an older event cannot regress a newer state", () => {
  let snapshot = initialSnapshot(LINK_LIFECYCLE, NOW.toISOString());
  const activate = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e1", targetState: "active", version: 5,
    occurredAt: "2026-09-01T12:05:00.000Z",
  });
  if (activate.kind === "applied") snapshot = activate.snapshot;

  const stale = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e0", targetState: "suspended", version: 2,
    occurredAt: "2026-09-01T12:02:00.000Z",
  });
  assert.equal(stale.kind, "stale");
  assert.equal(stale.snapshot.state, "active");
});

test("a newer terminal event cannot be overwritten by an older active event", () => {
  let snapshot = initialSnapshot(LINK_LIFECYCLE, NOW.toISOString());
  for (const event of [
    { eventId: "e1", targetState: "active" as const, version: 1, occurredAt: "2026-09-01T12:01:00.000Z" },
    { eventId: "e2", targetState: "revoked" as const, version: 2, occurredAt: "2026-09-01T12:02:00.000Z" },
  ]) {
    const outcome = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, event);
    if (outcome.kind === "applied") snapshot = outcome.snapshot;
  }
  assert.equal(snapshot.state, "revoked");

  const late = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e3", targetState: "active", version: 99,
    occurredAt: "2026-09-01T13:00:00.000Z",
  });
  assert.equal(late.kind, "rejected");
  assert.equal(late.snapshot.state, "revoked", "revocation must be permanent");
});

test("replay is order-independent", () => {
  const events = [
    { eventId: "e1", targetState: "active" as const, version: 1, occurredAt: "2026-09-01T12:01:00.000Z" },
    { eventId: "e2", targetState: "suspended" as const, version: 2, occurredAt: "2026-09-01T12:02:00.000Z" },
    { eventId: "e3", targetState: "revoked" as const, version: 3, occurredAt: "2026-09-01T12:03:00.000Z" },
  ];
  const forward = replayLifecycle(LINK_LIFECYCLE, events, NOW.toISOString());
  const reversed = replayLifecycle(LINK_LIFECYCLE, [...events].reverse(), NOW.toISOString());
  const shuffled = replayLifecycle(LINK_LIFECYCLE, [events[1]!, events[2]!, events[0]!], NOW.toISOString());
  assert.equal(forward.state, "revoked");
  assert.equal(reversed.state, forward.state);
  assert.equal(shuffled.state, forward.state);
});

test("revocation signals that access must be invalidated immediately", () => {
  let snapshot = initialSnapshot(LINK_LIFECYCLE, NOW.toISOString());
  const activate = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e1", targetState: "active", version: 1, occurredAt: "2026-09-01T12:01:00.000Z",
  });
  if (activate.kind === "applied") snapshot = activate.snapshot;

  const revoke = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e2", targetState: "revoked", version: 2, occurredAt: "2026-09-01T12:02:00.000Z",
  });
  assert.equal(revoke.kind, "applied");
  if (revoke.kind === "applied") assert.equal(revoke.invalidatesAccess, true);
});

test("an unknown target state fails closed", () => {
  const snapshot = initialSnapshot(LINK_LIFECYCLE, NOW.toISOString());
  const outcome = applyLifecycleEvent(LINK_LIFECYCLE, snapshot, {
    eventId: "e1",
    targetState: "superuser" as never,
    version: 1, occurredAt: NOW.toISOString(),
  });
  assert.equal(outcome.kind, "rejected");
  if (outcome.kind === "rejected") assert.equal(outcome.reason, "UNKNOWN_STATE");
});

test("every lifecycle has reachable terminal states and no escape", () => {
  for (const [name, definition] of [
    ["link", LINK_LIFECYCLE], ["share", SHARE_GRANT_LIFECYCLE],
    ["mandate", MANDATE_LIFECYCLE], ["admin", ADMIN_ASSIGNMENT_LIFECYCLE],
  ] as const) {
    assert.ok(definition.terminal.length > 0, `${name} needs a terminal state`);
    const transitions = definition.transitions as Record<string, readonly string[]>;
    for (const terminal of definition.terminal) {
      assert.deepEqual(transitions[terminal], [],
        `${name}.${terminal} must be a dead end`);
    }
  }
});

// ===========================================================================
// Stage 8 — delegated mandates
// ===========================================================================

const MANDATE_CHALLENGE = generateMandateChallenge();

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-1",
    professionalUserRef: PRO,
    clientUserRef: CLIENT,
    relationshipRef: "rel-1",
    representationRef: "repr-1",
    representationIsActive: true,
    professionalIsEligible: true,
    requestedScopes: ["delegated.portfolio.view"],
    knownScopes: KNOWN_SCOPES,
    purpose: "portfolio_setup",
    noticeVersion: "mandate-notice-v1",
    challenge: MANDATE_CHALLENGE,
    now: NOW,
    correlationId: "corr-1",
    isEnabled: true,
    ...overrides,
  } as Parameters<typeof createDelegationRequest>[0];
}

function validRequest(): DelegationRequest {
  const result = createDelegationRequest(requestInput());
  if (!result.ok) throw new Error("fixture invalid");
  return result.value;
}

function acceptInput(overrides: Record<string, unknown> = {}) {
  return {
    request: validRequest(),
    presentedChallenge: MANDATE_CHALLENGE,
    authenticatedUserRef: CLIENT,
    clientIsAuthenticated: true,
    portfolioRef: "portfolio-1",
    mandateId: "mandate-1",
    now: NOW,
    correlationId: "corr-1",
    isEnabled: true,
    ...overrides,
  } as Parameters<typeof acceptDelegationMandate>[0];
}

test("a professional cannot create a mandate naming themselves as client", () => {
  const result = createDelegationRequest(requestInput({ clientUserRef: PRO }));
  assert.deepEqual(result, { ok: false, reason: "SELF_DELEGATION_PROHIBITED" });
});

test("a professional cannot accept their own client mandate", () => {
  const result = acceptDelegationMandate(acceptInput({ authenticatedUserRef: PRO }));
  assert.deepEqual(result, { ok: false, reason: "SELF_DELEGATION_PROHIBITED" });
});

test("a third party cannot accept a mandate on the client's behalf", () => {
  const result = acceptDelegationMandate(acceptInput({ authenticatedUserRef: "user-other" }));
  assert.deepEqual(result, { ok: false, reason: "ACCEPTOR_IS_NOT_CLIENT" });
});

test("acceptance requires an authenticated client session", () => {
  const result = acceptDelegationMandate(acceptInput({ clientIsAuthenticated: false }));
  assert.deepEqual(result, { ok: false, reason: "CLIENT_NOT_AUTHENTICATED" });
});

test("a valid client acceptance creates an active mandate", () => {
  const result = acceptDelegationMandate(acceptInput());
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.clientUserRef, CLIENT);
    assert.equal(result.value.professionalUserRef, PRO);
    assert.equal(result.value.lifecycle.state, "active");
    assert.equal(result.value.portfolioRef, "portfolio-1");
  }
});

test("a prohibited scope cannot be requested", () => {
  for (const scope of [
    "delegated.payment.change", "delegated.export.bulk",
    "delegated.delete.permanent", "delegated.delegation.onward",
  ]) {
    const result = createDelegationRequest(requestInput({ requestedScopes: [scope] }));
    assert.deepEqual(result, { ok: false, reason: "PROHIBITED_SCOPE_REQUESTED" }, scope);
  }
});

test("an unknown scope cannot be requested", () => {
  const result = createDelegationRequest(requestInput({
    requestedScopes: ["delegated.invented"],
  }));
  assert.deepEqual(result, { ok: false, reason: "UNKNOWN_SCOPE_REQUESTED" });
});

test("a request without active representation is refused", () => {
  const result = createDelegationRequest(requestInput({ representationIsActive: false }));
  assert.deepEqual(result, { ok: false, reason: "REPRESENTATION_NOT_ACTIVE" });
});

test("an ineligible professional cannot request delegation", () => {
  const result = createDelegationRequest(requestInput({ professionalIsEligible: false }));
  assert.deepEqual(result, { ok: false, reason: "PROFESSIONAL_NOT_ELIGIBLE" });
});

test("assisted consent is refused unless separately enabled", () => {
  const result = acceptDelegationMandate(acceptInput({
    assistedConsent: { requested: true, enabled: false },
  }));
  assert.deepEqual(result, { ok: false, reason: "ASSISTED_CONSENT_NOT_ENABLED" });
});

test("an expired acceptance challenge fails closed", () => {
  const result = acceptDelegationMandate(acceptInput({
    now: new Date("2026-09-05T00:00:00.000Z"),
  }));
  assert.deepEqual(result, { ok: false, reason: "REQUEST_EXPIRED" });
});

test("a consumed request cannot be replayed", () => {
  const consumed = { ...validRequest(), consumedAt: NOW.toISOString() };
  const result = acceptDelegationMandate(acceptInput({ request: consumed }));
  assert.deepEqual(result, { ok: false, reason: "REQUEST_ALREADY_CONSUMED" });
});

test("mandate permissions default to nothing beyond what was granted", () => {
  const result = acceptDelegationMandate(acceptInput());
  assert.ok(result.ok);
  if (!result.ok) return;
  const mandate = result.value;
  const conditions = { now: NOW, representationIsActive: true, professionalIsEligible: true };

  assert.equal(mandatePermits(mandate, "delegated.portfolio.view", conditions).ok, true);
  for (const notGranted of [
    "delegated.analysis.create", "delegated.report.prepare", "delegated.result.share_back",
  ]) {
    assert.equal(mandatePermits(mandate, notGranted, conditions).ok, false, notGranted);
  }
});

test("ended representation suspends delegated access immediately", () => {
  const result = acceptDelegationMandate(acceptInput());
  assert.ok(result.ok);
  if (!result.ok) return;
  const denied = mandatePermits(result.value, "delegated.portfolio.view", {
    now: NOW, representationIsActive: false, professionalIsEligible: true,
  });
  assert.deepEqual(denied, { ok: false, reason: "REPRESENTATION_ENDED" });
});

test("lost professional eligibility suspends delegated access immediately", () => {
  const result = acceptDelegationMandate(acceptInput());
  assert.ok(result.ok);
  if (!result.ok) return;
  const denied = mandatePermits(result.value, "delegated.portfolio.view", {
    now: NOW, representationIsActive: true, professionalIsEligible: false,
  });
  assert.deepEqual(denied, { ok: false, reason: "ELIGIBILITY_LOST" });
});

test("an expired mandate stops permitting access", () => {
  const result = acceptDelegationMandate(acceptInput());
  assert.ok(result.ok);
  if (!result.ok) return;
  const denied = mandatePermits(result.value, "delegated.portfolio.view", {
    now: new Date("2027-01-01T00:00:00.000Z"),
    representationIsActive: true, professionalIsEligible: true,
  });
  assert.deepEqual(denied, { ok: false, reason: "MANDATE_EXPIRED" });
});

test("a suspended mandate permits nothing", () => {
  const result = acceptDelegationMandate(acceptInput());
  assert.ok(result.ok);
  if (!result.ok) return;
  const suspended: DelegationMandate = {
    ...result.value,
    lifecycle: { ...result.value.lifecycle, state: "suspended" },
  };
  assert.equal(
    mandatePermits(suspended, "delegated.portfolio.view", {
      now: NOW, representationIsActive: true, professionalIsEligible: true,
    }).ok,
    false,
  );
});

test("delegated mandates are disabled by default", () => {
  assert.deepEqual(createDelegationRequest(requestInput({ isEnabled: false })),
    { ok: false, reason: "FEATURE_DISABLED" });
  assert.deepEqual(acceptDelegationMandate(acceptInput({ isEnabled: false })),
    { ok: false, reason: "FEATURE_DISABLED" });
});

// ===========================================================================
// Entitlement
// ===========================================================================

const ORG_SUBJECT = { kind: "organization" as const, subjectRef: "org-1" };

function projection(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "lighthouse-product-entitlement.v2",
    entitlementId: "ent-1",
    subscriptionId: "sub-1",
    subject: ORG_SUBJECT,
    productKey: "investscape",
    packageKey: "professional_suite",
    featureKeys: ["investscape_workspace", "deal_analyzer"],
    limits: { professionalSeats: 1, delegatedPortfolios: 5 },
    accessStatus: "active",
    renewalIntent: "renew",
    issuedAt: "2026-08-01T00:00:00.000Z",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
    version: 1,
    correlationId: "corr-1",
    ...overrides,
  };
}

function ingest(overrides: Record<string, unknown> = {}) {
  return ingestEntitlementProjection({
    payload: projection(),
    signatureValid: true,
    expectedSubject: ORG_SUBJECT,
    existing: null,
    now: NOW,
    isEnabled: true,
    ...overrides,
  } as Parameters<typeof ingestEntitlementProjection>[0]);
}

test("a valid signed projection is ingested", () => {
  const result = ingest();
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entitlement.lifecycle.state, "active");
    assert.deepEqual(result.entitlement.featureKeys,
      ["investscape_workspace", "deal_analyzer"]);
  }
});

test("an unsigned projection is rejected", () => {
  assert.deepEqual(ingest({ signatureValid: false }),
    { ok: false, reason: "SIGNATURE_INVALID" });
});

test("a projection for another product is rejected", () => {
  const result = ingest({ payload: projection({ productKey: "relationship_os" }) });
  assert.deepEqual(result, { ok: false, reason: "WRONG_PRODUCT" });
});

test("a projection for another organization is rejected", () => {
  const result = ingest({ payload: projection({ subject: { kind: "organization", subjectRef: "org-EVIL" } }) });
  assert.deepEqual(result, { ok: false, reason: "WRONG_SUBJECT" });
});

test("an individual-subject projection is not usable for an organization expectation", () => {
  const result = ingest({
    payload: projection({ subject: { kind: "individual", subjectRef: "org-1" } }),
  });
  assert.deepEqual(result, { ok: false, reason: "WRONG_SUBJECT" });
});

test("an unknown schema version fails closed", () => {
  const result = ingest({ payload: projection({ schemaVersion: "lighthouse-product-entitlement.v1" }) });
  assert.deepEqual(result, { ok: false, reason: "UNKNOWN_SCHEMA" });
});

test("a stale version cannot reactivate a revoked entitlement", () => {
  const first = ingest({ payload: projection({ accessStatus: "revoked", version: 5 }) });
  assert.ok(first.ok);
  if (!first.ok) return;

  const replayed = ingest({
    payload: projection({ accessStatus: "active", version: 2 }),
    existing: first.entitlement,
  });
  assert.deepEqual(replayed, { ok: false, reason: "STALE_VERSION" });
});

test("cancel-at-term-end keeps access active until effectiveTo, not before", () => {
  // REGRESSION for the review's P1: cancellation intent must not be read as
  // an access state. accessStatus stays "active"; only renewalIntent changes.
  const result = ingest({
    payload: projection({
      accessStatus: "active",
      renewalIntent: "cancel_at_term_end",
      effectiveTo: "2026-12-01T00:00:00.000Z",
    }),
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.entitlement.renewalIntent, "cancel_at_term_end");
  assert.equal(hasFeature(result.entitlement, "investscape_workspace", NOW), true);
  assert.equal(
    entitlementIsUsable(result.entitlement, new Date("2026-12-02T00:00:00.000Z")),
    false,
  );
});

test("an identical version is an idempotent no-op", () => {
  const first = ingest();
  assert.ok(first.ok);
  if (!first.ok) return;
  const again = ingest({ existing: first.entitlement });
  assert.ok(again.ok);
  if (again.ok) assert.equal(again.changed, false);
});

test("unknown feature keys are retained but never granted", () => {
  const result = ingest({
    payload: projection({ featureKeys: ["investscape_workspace", "admin_backdoor"] }),
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.entitlement.unknownFeatureKeys, ["admin_backdoor"]);
  assert.equal(hasFeature(result.entitlement, "admin_backdoor", NOW), false);
  assert.equal(hasFeature(result.entitlement, "investscape_workspace", NOW), true);
});

test("an active suite entitlement suppresses a duplicate checkout", () => {
  const result = ingest();
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(resolveCheckoutPrompt(result.entitlement, NOW, true),
    { kind: "none", reason: "entitled" });
});

test("a missing projection while syncing shows a neutral state, not a second checkout", () => {
  assert.deepEqual(resolveCheckoutPrompt(null, NOW, true),
    { kind: "synchronizing", reason: "stale_or_missing_projection" });
});

test("InvestScape-only personal usage needs no Relationship OS link", () => {
  // Sync disabled and no projection: an independent B2C user is simply offered
  // an InvestScape purchase. No link, no relationship, no error.
  assert.deepEqual(resolveCheckoutPrompt(null, NOW, false), { kind: "offer_checkout" });
});

test("a revoked entitlement grants no features", () => {
  const result = ingest({ payload: projection({ accessStatus: "revoked", version: 3 }) });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(hasFeature(result.entitlement, "investscape_workspace", NOW), false);
});

test("paying never grants authority over another person's portfolio", () => {
  assert.equal(entitlementGrantsPortfolioAuthority(), false);
});

test("entitlement sync is disabled by default", async () => {
  const adapter = new DisabledEntitlementSyncAdapter();
  assert.deepEqual(await adapter.fetchProjection("org-1"), { kind: "disabled" });
});

test("entitlement ingestion is disabled by default", () => {
  assert.deepEqual(ingest({ isEnabled: false }), { ok: false, reason: "FEATURE_DISABLED" });
});

test("a stored entitlement carries no billing fields", () => {
  const result = ingest();
  assert.ok(result.ok);
  if (!result.ok) return;
  const serialised = JSON.stringify(result.entitlement).toLowerCase();
  for (const forbidden of ["price", "invoice", "card", "stripe", "renewaldate", "billingemail"]) {
    assert.ok(!serialised.includes(forbidden), `${forbidden} leaked`);
  }
});

// ===========================================================================
// Cross-product message validation
// ===========================================================================

test("an unknown schema version fails closed at the boundary", () => {
  const result = validateCrossProductMessage({
    schemaVersion: "investscape.analysis.shared.v99", shareGrantId: "g1",
  });
  assert.deepEqual(result, { ok: false, reason: "UNKNOWN_SCHEMA" });
});

test("a message with no schema version fails closed", () => {
  assert.deepEqual(validateCrossProductMessage({ shareGrantId: "g1" }),
    { ok: false, reason: "UNKNOWN_SCHEMA" });
  assert.equal(validateCrossProductMessage(null).ok, false);
  assert.equal(validateCrossProductMessage("string").ok, false);
});

test("a known schema with an undeclared field is rejected", () => {
  const result = validateCrossProductMessage({
    schemaVersion: "investscape.connection.changed.v1",
    eventId: "e1", version: 1,
    occurredAt: "2026-09-01T12:00:00.000Z", correlationId: "c1",
    crossProductLinkId: "link-1", state: "active",
    planName: "Professional Suite",
  });
  assert.deepEqual(result, { ok: false, reason: "INVALID_PAYLOAD", issues: result.ok ? undefined : result.issues });
  assert.equal(result.ok, false);
});

test("a valid connection-changed event validates", () => {
  const result = validateCrossProductMessage({
    schemaVersion: "investscape.connection.changed.v1",
    eventId: "e1", version: 1,
    occurredAt: "2026-09-01T12:00:00.000Z", correlationId: "c1",
    crossProductLinkId: "link-1", state: "active",
  });
  assert.equal(result.ok, true);
});

test("no cross-product event schema accepts a billing or email field", () => {
  // A shared-analysis event carrying billing data must fail, not be sanitised.
  const result = validateCrossProductMessage({
    schemaVersion: "investscape.analysis.shared.v1",
    eventId: "e1", version: 1,
    occurredAt: "2026-09-01T12:00:00.000Z", correlationId: "c1",
    shareGrantId: "g1", externalAnalysisId: "a1", status: "complete",
    summary: { grade: "A" }, sharedAt: "2026-09-01T12:00:00.000Z",
    email: "client@example.com", paymentStatus: "paid",
  });
  assert.equal(result.ok, false);
});
