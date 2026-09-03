/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * Stage 1 receiver contract tests.
 * Covers the required-test list in CLAUDE_INVESTSCAPE_RECEIVER_IMPLEMENTATION_PROMPT_V0.2 §15.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALLBACK_CONFLICT_CODES, KNOWN_MODULES, buildResultReference,
  enforceScopeRedaction, isPermittedResultTransition, parseLaunchContext,
  parseResultReference, parseResultReferenceAck, partitionModules,
} from "./contracts.ts";
import { mapRedemptionFailure } from "./errors.ts";
import { redeemLaunchSession } from "./redemptionClient.ts";
import {
  InMemoryAnalysisBindingRepository, bindingFromLaunchContext,
} from "./analysisBinding.ts";
import {
  InMemoryOutboxRepository, applyDeliveryOutcome, backoffDelayMs,
  classifyResponse, enqueueResultCallback, type OutboxEntry,
} from "./callbackOutbox.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";
const CODE = "super-secret-one-time-code-abc123-xyz789";
const NOW = new Date("2026-09-01T12:00:00.000Z");

const validContext = {
  schemaVersion: "investscape-launch-context.v1",
  launchSessionId: SESSION,
  analysisType: "investment_quick_review",
  modules: ["property_overview", "financial_summary"],
  permittedScopes: ["property.basic", "finance.summary"],
  redactedScopes: ["finance.raw"],
  expiresAt: "2026-09-01T12:05:00.000Z",
  context: { property: { propertyRef: "prop-opaque-1", propertyType: "detached", jurisdiction: "BC" } },
  correlationId: "corr-1",
};

const config = {
  baseUrl: "https://relationship-os.example.test",
  keyId: "key-1",
  secret: "secret-1",
};

function deps(fetchImpl: typeof globalThis.fetch) {
  return { fetch: fetchImpl, now: () => 1787920000, newOperationId: () => "op-1" };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

// --- Producer response golden test -----------------------------------------
//
// Reconstructed from the ACTUAL producer implementation
// (packages/analysis-gateway/gatewayService.ts) applied to the exact DB row in
// its own contract suite (tests/investscape-redemption-v0.2.test.mjs), both on
// origin/feature/investscape-launch-v0.1. This is what really comes back on a
// successful redemption — not what the prose describes.
//
// It caught a live defect: the property field is `address`, not
// `formattedAddress`. Since we parse .strict(), that would have rejected every
// successful redemption in production.

test("the real producer redemption response parses", () => {
  const producerResponse = {
    schemaVersion: "investscape-launch-context.v1",
    // Producer fixture ID (a valid RFC 9562 v4 UUID, unlike the older v0.1 one).
    launchSessionId: "11111111-2222-4333-8444-555555555555",
    analysisType: "investment_quick_review",
    modules: ["property_overview", "financial_summary"],
    permittedScopes: ["property.basic", "finance.summary"],
    redactedScopes: ["finance.raw"],
    expiresAt: "2026-08-28T13:05:00.000Z",
    context: {
      property: {
        // sha256(`${sessionId}:${propertyId}`) — 64 hex chars.
        propertyRef: "a".repeat(64),
        propertyType: "condo",
        // jurisdictions.name — the full name, not a two-letter code.
        jurisdiction: "British Columbia",
        // [line1,line2,city,subdivision,postal_code,country_code] joined.
        address: "123 Main Street, Vancouver, BC, V0V 0V0, CA",
        // Number(row.list_price) — the DB column is text, the wire value is a number.
        listPrice: 899000,
        currency: "CAD",
      },
    },
    correlationId: "corr-1",
  };

  const parsed = parseLaunchContext(producerResponse);
  assert.equal(parsed.ok, true,
    parsed.ok ? "" : `producer response rejected: ${parsed.issues.join("; ")}`);
});

// --- Scope-enforcement defect (2026-09-02 architecture review, P0) ---------
//
// CONFIRMED DEFECT: the producer's gatewayService.ts attaches
// listPrice/currency whenever the underlying row has them, WITHOUT
// conditioning on permittedScopes/redactedScopes. `redactedScopes` on the
// wire is currently decorative, not enforced. We do not trust the producer's
// own labelling — we enforce our local scope->field allow-list on every
// redemption, unconditionally.

test("a field whose governing scope is redacted is stripped even though the producer sent it", () => {
  // Exactly the defect: the producer marks finance.summary redacted but still
  // sends listPrice/currency in the same payload.
  const leaky = parseLaunchContext({
    ...producerLikeContext(),
    permittedScopes: ["property.basic", "property.address"],
    redactedScopes: ["finance.summary"],
  });
  assert.ok(leaky.ok);
  if (!leaky.ok) return;

  const { context, droppedFields } = enforceScopeRedaction(leaky.value);
  assert.deepEqual(droppedFields.sort(), ["currency", "listPrice"]);
  assert.equal("listPrice" in context.context.property, false);
  assert.equal("currency" in context.context.property, false);
  // address's scope IS permitted, so it survives; only the redacted-scope
  // fields are stripped.
  assert.equal(context.context.property.address, "123 Main Street, Vancouver, BC, V0V 0V0, CA");
  // A structural field with no gating scope survives untouched.
  assert.equal(context.context.property.propertyType, "condo");
});

test("a field whose scope was never permitted at all is stripped, not just redacted ones", () => {
  const context = parseLaunchContext({
    ...producerLikeContext(),
    permittedScopes: [], // nothing granted
    redactedScopes: [],
  });
  assert.ok(context.ok);
  if (!context.ok) return;

  const { droppedFields } = enforceScopeRedaction(context.value);
  assert.deepEqual(droppedFields.sort(), ["address", "currency", "listPrice"]);
});

test("a field whose scope IS currently permitted and NOT redacted survives", () => {
  const context = parseLaunchContext({
    ...producerLikeContext(),
    permittedScopes: ["property.basic", "property.address", "finance.summary"],
    redactedScopes: [],
  });
  assert.ok(context.ok);
  if (!context.ok) return;

  const { context: redacted, droppedFields } = enforceScopeRedaction(context.value);
  assert.deepEqual(droppedFields, []);
  assert.equal(redacted.context.property.listPrice, 899000);
  assert.equal(redacted.context.property.address, "123 Main Street, Vancouver, BC, V0V 0V0, CA");
});

function producerLikeContext() {
  return {
    schemaVersion: "investscape-launch-context.v1",
    launchSessionId: "11111111-2222-4333-8444-555555555555",
    analysisType: "investment_quick_review",
    modules: ["property_overview", "financial_summary"],
    permittedScopes: ["property.basic"],
    redactedScopes: [] as string[],
    expiresAt: "2026-08-28T13:05:00.000Z",
    context: {
      property: {
        propertyRef: "a".repeat(64),
        propertyType: "condo",
        jurisdiction: "British Columbia",
        address: "123 Main Street, Vancouver, BC, V0V 0V0, CA",
        listPrice: 899000,
        currency: "CAD",
      },
    },
    correlationId: "corr-1",
  };
}

test("the address field is 'address' — 'formattedAddress' is rejected", () => {
  // Pins the exact defect found on 2026-09-01. If someone "corrects" the schema
  // back to the prose wording, this fails rather than silently breaking prod.
  const wrong = {
    ...validContext,
    context: { property: { propertyRef: "p1", formattedAddress: "123 Main St" } },
  };
  assert.equal(parseLaunchContext(wrong).ok, false);
});

test("a listing with no price or currency still parses", () => {
  // The producer omits both keys when list_price is null.
  const noListing = {
    ...validContext,
    context: {
      property: {
        propertyRef: "p1", propertyType: "condo",
        jurisdiction: "British Columbia", address: "123 Main Street, CA",
      },
    },
  };
  assert.equal(parseLaunchContext(noListing).ok, true);
});

test("the producer's acknowledgement body parses", () => {
  // Exactly what gatewayService.handleAnalysisReference returns on 200.
  const ack = parseResultReferenceAck({
    schemaVersion: "investscape-result-reference-ack.v1",
    analysisReferenceId: "ref-uuid-1",
    externalAnalysisId: "analysis-1",
    status: "complete",
    acceptedAt: "2026-09-01T12:01:00.000Z",
  });
  assert.equal(ack.ok, true);
  if (ack.ok) assert.equal(ack.value.analysisReferenceId, "ref-uuid-1");
});

test("an acknowledgement with an extra field is still accepted", () => {
  // Their ack, their schema. Rejecting an unknown field would strand a callback
  // they have already committed — the opposite of the inbound launch-context
  // rule, where strictness protects us.
  const ack = parseResultReferenceAck({
    analysisReferenceId: "ref-1",
    somethingTheyAddedLater: true,
  });
  assert.equal(ack.ok, true);
});

test("all producer 409 codes are treated as permanent, not retryable", () => {
  for (const _code of CALLBACK_CONFLICT_CODES) {
    assert.equal(classifyResponse(409).kind, "permanent");
  }
  assert.equal(CALLBACK_CONFLICT_CODES.length, 5);
});

test("externalAnalysisId accepts the producer's full 160-character bound", () => {
  const built = buildResultReference({
    launchSessionId: SESSION,
    externalAnalysisId: "a".repeat(160),
    status: "complete",
  });
  assert.equal(built.ok, true, "160 chars is valid per the producer's boundedString(v,1,160)");

  const tooLong = buildResultReference({
    launchSessionId: SESSION,
    externalAnalysisId: "a".repeat(161),
    status: "complete",
  });
  assert.equal(tooLong.ok, false);
});

// --- Contract validation ---------------------------------------------------

test("a valid launch context parses", () => {
  const parsed = parseLaunchContext(validContext);
  assert.equal(parsed.ok, true);
});

test("an undeclared field is rejected rather than silently accepted", () => {
  const parsed = parseLaunchContext({ ...validContext, clientSecret: "leak" });
  assert.equal(parsed.ok, false);
});

test("an undeclared property field is rejected", () => {
  const parsed = parseLaunchContext({
    ...validContext,
    context: { property: { propertyRef: "p1", ownerSin: "123-456-789" } },
  });
  assert.equal(parsed.ok, false);
});

test("a wrong schema version fails closed", () => {
  const parsed = parseLaunchContext({ ...validContext, schemaVersion: "investscape-launch-context.v2" });
  assert.equal(parsed.ok, false);
});

test("validation issues carry paths and codes but never received values", () => {
  const parsed = parseLaunchContext({ ...validContext, launchSessionId: CODE });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    const joined = parsed.issues.join(" ");
    assert.ok(!joined.includes(CODE), "a rejected value must not reach the issue list");
  }
});

// --- Module allow-listing --------------------------------------------------

test("unknown modules are dropped and reported, not rendered", () => {
  const { permitted, rejected } = partitionModules([
    "property_overview", "evil_module", "../../admin", "financial_summary",
  ]);
  assert.deepEqual(permitted, ["property_overview", "financial_summary"]);
  assert.deepEqual(rejected, ["evil_module", "../../admin"]);
});

test("the allow-list covers every module the producer is known to emit", () => {
  for (const m of ["property_overview", "financial_summary"]) {
    assert.ok((KNOWN_MODULES as readonly string[]).includes(m), m);
  }
});

// --- Error mapping ---------------------------------------------------------

test("a wrong code and an unknown session are indistinguishable", () => {
  const notFound = mapRedemptionFailure(404, "LAUNCH_SESSION_NOT_FOUND");
  const malformed = mapRedemptionFailure(400, "LAUNCH_REQUEST_MALFORMED");
  assert.deepEqual(notFound, malformed);
  assert.equal(notFound.state, "invalid");
});

test("expired maps to 410 -> expired, non-retryable", () => {
  const failure = mapRedemptionFailure(410, "LAUNCH_SESSION_EXPIRED");
  assert.equal(failure.state, "expired");
  assert.equal(failure.retryable, false);
});

test("consumed maps to 409 -> consumed and never offers a retry", () => {
  const failure = mapRedemptionFailure(409, "LAUNCH_SESSION_ALREADY_CONSUMED");
  assert.equal(failure.state, "consumed");
  assert.equal(failure.retryable, false, "must never resend a consumed code");
});

test("revoked maps to 403 -> unavailable", () => {
  const failure = mapRedemptionFailure(403, "LAUNCH_SESSION_REVOKED");
  assert.equal(failure.state, "unavailable");
});

test("service-auth failure is neutral to the user but alerts the operator", () => {
  const failure = mapRedemptionFailure(401, "SERVICE_AUTH_FAILED");
  assert.equal(failure.state, "unavailable");
  assert.equal(failure.alert, true);
  assert.ok(!/auth|signature|hmac|key/i.test(failure.message), failure.message);
});

test("no failure message leaks security detail", () => {
  for (const status of [400, 401, 403, 404, 409, 410, 500]) {
    const { message } = mapRedemptionFailure(status);
    assert.ok(!/hmac|signature|secret|nonce|sql|stack/i.test(message), message);
  }
});

test("every mapped failure is non-retryable in the browser", () => {
  for (const status of [400, 401, 403, 404, 409, 410, 500]) {
    assert.equal(mapRedemptionFailure(status).retryable, false, String(status));
  }
});

// --- Redemption client -----------------------------------------------------

test("a successful redemption returns the validated context", async () => {
  const outcome = await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE },
    config,
    deps(async () => jsonResponse(200, validContext)),
  );
  assert.equal(outcome.kind, "success");
});

test("the one-time code is sent in the body and never in the URL", async () => {
  let seenUrl = "";
  let seenBody = "";
  await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE },
    config,
    deps(async (url, init) => {
      seenUrl = String(url);
      seenBody = String((init as RequestInit).body);
      return jsonResponse(200, validContext);
    }),
  );
  assert.ok(!seenUrl.includes(CODE), "code must never appear in the URL");
  assert.ok(seenBody.includes(CODE), "code belongs in the request body");
});

test("the shared secret is never transmitted", async () => {
  let seenHeaders = "";
  let seenBody = "";
  await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE },
    config,
    deps(async (_url, init) => {
      seenHeaders = JSON.stringify((init as RequestInit).headers);
      seenBody = String((init as RequestInit).body);
      return jsonResponse(200, validContext);
    }),
  );
  assert.ok(!seenHeaders.includes("secret-1"));
  assert.ok(!seenBody.includes("secret-1"));
});

test("a timeout returns ambiguous and does NOT retry", async () => {
  let calls = 0;
  const outcome = await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE },
    { ...config, timeoutMs: 10 },
    deps(async () => {
      calls += 1;
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }),
  );
  assert.equal(calls, 1, "a single-use code must never be resent automatically");
  assert.equal(outcome.kind, "ambiguous");
  if (outcome.kind === "ambiguous") {
    assert.equal(outcome.reason, "timeout");
    assert.equal(outcome.operationId, "op-1");
  }
});

test("an ambiguous outcome never carries the code", async () => {
  const outcome = await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE }, config,
    deps(async () => { throw new Error("ECONNRESET"); }),
  );
  assert.ok(!JSON.stringify(outcome).includes(CODE));
});

test("a 200 with an unparseable body is ambiguous, not success", async () => {
  const outcome = await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE }, config,
    deps(async () => new Response("not json", { status: 200 })),
  );
  assert.equal(outcome.kind, "ambiguous");
});

test("a 200 failing schema validation is ambiguous, never partially applied", async () => {
  const outcome = await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE }, config,
    deps(async () => jsonResponse(200, { schemaVersion: "wrong" })),
  );
  assert.equal(outcome.kind, "ambiguous");
});

test("missing configuration fails closed and never calls out", async () => {
  let called = false;
  const outcome = await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE }, null,
    deps(async () => { called = true; return jsonResponse(200, validContext); }),
  );
  assert.equal(outcome.kind, "unconfigured");
  assert.equal(called, false);
});

test("a plaintext http destination is refused", async () => {
  const outcome = await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE },
    { ...config, baseUrl: "http://relationship-os.example.test" },
    deps(async () => jsonResponse(200, validContext)),
  );
  assert.equal(outcome.kind, "unconfigured");
});

test("the request carries x-lighthouse service headers", async () => {
  let headers: Record<string, string> = {};
  await redeemLaunchSession(
    { launchSessionId: SESSION, code: CODE }, config,
    deps(async (_u, init) => {
      headers = (init as RequestInit).headers as Record<string, string>;
      return jsonResponse(200, validContext);
    }),
  );
  assert.equal(headers["x-lighthouse-service"], "investscape");
  assert.match(headers["x-lighthouse-signature"] ?? "", /^[0-9a-f]{64}$/);
});

// --- Analysis binding ------------------------------------------------------

test("a binding never carries the one-time code", () => {
  const parsed = parseLaunchContext(validContext);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const { binding } = bindingFromLaunchContext(parsed.value, "analysis-1", NOW.toISOString());
  assert.ok(!JSON.stringify(binding).includes(CODE));
  assert.deepEqual(binding.redactedScopes, ["finance.raw"]);
});

test("binding creation is idempotent on launchSessionId", async () => {
  const repo = new InMemoryAnalysisBindingRepository();
  const parsed = parseLaunchContext(validContext);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const first = bindingFromLaunchContext(parsed.value, "analysis-1", NOW.toISOString());
  const a = await repo.createIfAbsent(first.binding);
  const second = bindingFromLaunchContext(parsed.value, "analysis-2", NOW.toISOString());
  const b = await repo.createIfAbsent(second.binding);

  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(b.binding.analysisId, "analysis-1", "must adopt the first analysis");
  assert.equal(repo.size, 1);
});

test("concurrent landing requests create exactly one analysis", async () => {
  const repo = new InMemoryAnalysisBindingRepository();
  const parsed = parseLaunchContext(validContext);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const results = await Promise.all(
    ["a", "b", "c", "d", "e"].map((id) =>
      repo.createIfAbsent(
        bindingFromLaunchContext(parsed.value, `analysis-${id}`, NOW.toISOString()).binding,
      ),
    ),
  );
  assert.equal(repo.size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
  const ids = new Set(results.map((r) => r.binding.analysisId));
  assert.equal(ids.size, 1, "all callers converge on one analysis");
});

test("unknown modules are excluded from the persisted binding", () => {
  const parsed = parseLaunchContext({
    ...validContext, modules: ["property_overview", "admin_panel"],
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const { binding, rejectedModules } = bindingFromLaunchContext(
    parsed.value, "analysis-1", NOW.toISOString());
  assert.deepEqual(binding.permittedModules, ["property_overview"]);
  assert.deepEqual(rejectedModules, ["admin_panel"]);
});

// --- Result reference bounds -----------------------------------------------

test("only the three permitted summary keys survive", () => {
  const built = buildResultReference({
    launchSessionId: SESSION,
    externalAnalysisId: "analysis-1",
    status: "complete",
    summary: {
      grade: "B+",
      primaryOpportunity: "Rent upside",
      primaryRisk: "Rate exposure",
      // None of these may cross the boundary:
      rawWorksheet: { noi: 12345 },
      clientNotes: "private",
      modelTrace: "chain-of-thought",
      mortgageDocument: "base64…",
    },
  });
  assert.ok(built.ok);
  if (!built.ok) return;
  assert.deepEqual(Object.keys(built.value.summary ?? {}).sort(),
    ["grade", "primaryOpportunity", "primaryRisk"]);
  const serialised = JSON.stringify(built.value);
  for (const leak of ["rawWorksheet", "clientNotes", "modelTrace", "mortgageDocument", "12345"]) {
    assert.ok(!serialised.includes(leak), `${leak} leaked`);
  }
});

test("summary field length bounds are enforced", () => {
  assert.equal(parseResultReference({
    schemaVersion: "investscape-result-reference.v1",
    launchSessionId: SESSION, externalAnalysisId: "a1",
    analysisType: "investment_quick_review", status: "complete",
    summary: { grade: "x".repeat(17) },
  }).ok, false, "grade max is 16");

  assert.equal(parseResultReference({
    schemaVersion: "investscape-result-reference.v1",
    launchSessionId: SESSION, externalAnalysisId: "a1",
    analysisType: "investment_quick_review", status: "complete",
    summary: { primaryRisk: "x".repeat(281) },
  }).ok, false, "primaryRisk max is 280");
});

test("a complete status with no summary is valid", () => {
  const built = buildResultReference({
    launchSessionId: SESSION, externalAnalysisId: "a1", status: "complete",
  });
  assert.ok(built.ok);
  if (built.ok) assert.equal(built.value.summary, undefined);
});

// --- Status monotonicity ---------------------------------------------------

test("permitted transitions: draft -> complete/failed, and identical retries", () => {
  assert.equal(isPermittedResultTransition(null, "draft"), true);
  assert.equal(isPermittedResultTransition("draft", "complete"), true);
  assert.equal(isPermittedResultTransition("draft", "failed"), true);
  assert.equal(isPermittedResultTransition("draft", "draft"), true);
  assert.equal(isPermittedResultTransition("complete", "complete"), true);
});

test("a terminal status can never move to another status", () => {
  assert.equal(isPermittedResultTransition("complete", "draft"), false);
  assert.equal(isPermittedResultTransition("complete", "failed"), false);
  assert.equal(isPermittedResultTransition("failed", "complete"), false);
  assert.equal(isPermittedResultTransition("failed", "draft"), false);
});

// --- Outbox ----------------------------------------------------------------

const outboxDeps = { now: () => NOW, newId: () => `id-${Math.random()}` };

function reference(status: "draft" | "complete" | "failed", grade?: string) {
  const built = buildResultReference({
    launchSessionId: SESSION, externalAnalysisId: "analysis-1",
    status, ...(grade ? { summary: { grade } } : {}),
  });
  if (!built.ok) throw new Error("fixture invalid");
  return built.value;
}

test("a draft callback enqueues", async () => {
  const repo = new InMemoryOutboxRepository();
  const result = await enqueueResultCallback(reference("draft"), repo, outboxDeps);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.entry.state, "pending");
});

test("draft then complete is allowed", async () => {
  const repo = new InMemoryOutboxRepository();
  await enqueueResultCallback(reference("draft"), repo, outboxDeps);
  const result = await enqueueResultCallback(reference("complete"), repo, outboxDeps);
  assert.equal(result.ok, true);
});

test("an identical retry deduplicates instead of double-sending", async () => {
  const repo = new InMemoryOutboxRepository();
  const first = await enqueueResultCallback(reference("draft"), repo, outboxDeps);
  const second = await enqueueResultCallback(reference("draft"), repo, outboxDeps);
  assert.ok(first.ok && second.ok);
  if (first.ok && second.ok) {
    assert.equal(second.deduplicated, true);
    assert.equal(second.entry.id, first.entry.id);
  }
  assert.equal(repo.all.length, 1);
});

test("status regression after a terminal state is rejected", async () => {
  const repo = new InMemoryOutboxRepository();
  await enqueueResultCallback(reference("complete"), repo, outboxDeps);
  const regressed = await enqueueResultCallback(reference("draft"), repo, outboxDeps);
  assert.deepEqual(regressed, { ok: false, reason: "TERMINAL_ALREADY_SENT" });
});

test("complete cannot be followed by failed", async () => {
  const repo = new InMemoryOutboxRepository();
  await enqueueResultCallback(reference("complete"), repo, outboxDeps);
  const result = await enqueueResultCallback(reference("failed"), repo, outboxDeps);
  assert.equal(result.ok, false);
});

test("out-of-order delivery cannot regress a terminal state", async () => {
  const repo = new InMemoryOutboxRepository();
  await enqueueResultCallback(reference("draft"), repo, outboxDeps);
  await enqueueResultCallback(reference("complete"), repo, outboxDeps);
  // A delayed duplicate draft arrives after the terminal event.
  const late = await enqueueResultCallback(reference("draft", "A"), repo, outboxDeps);
  assert.equal(late.ok, false);
});

test("a 200 acknowledgement records the reference id and stops retrying", () => {
  const entry = {
    id: "e1", launchSessionId: SESSION, externalAnalysisId: "a1",
    targetStatus: "complete" as const, payloadHash: "h", payload: "{}",
    state: "pending" as const, attempts: 0, nextAttemptAt: NOW.toISOString(),
  };
  const updated = applyDeliveryOutcome(entry, {
    kind: "acknowledged", analysisReferenceId: "ref-1", acceptedAt: "2026-09-01T12:01:00.000Z",
  }, NOW);
  assert.equal(updated.state, "acknowledged");
  assert.equal(updated.analysisReferenceId, "ref-1");
  assert.equal(updated.acceptedAt, "2026-09-01T12:01:00.000Z");
});

test("transport failures back off exponentially within bounds", () => {
  assert.equal(backoffDelayMs(1), 1000);
  assert.equal(backoffDelayMs(2), 2000);
  assert.equal(backoffDelayMs(3), 4000);
  assert.ok(backoffDelayMs(20) <= 300_000, "backoff must stay bounded");
});

test("the retry budget is finite and then terminates", () => {
  let entry: OutboxEntry = {
    id: "e1", launchSessionId: SESSION, externalAnalysisId: "a1",
    targetStatus: "complete", payloadHash: "h", payload: "{}",
    state: "pending", attempts: 0, nextAttemptAt: NOW.toISOString(),
  };
  for (let i = 0; i < 10; i += 1) {
    entry = applyDeliveryOutcome(entry, { kind: "retryable", reason: "server_500" }, NOW);
  }
  assert.equal(entry.state, "failed_permanent");
  assert.match(entry.lastError ?? "", /retry_budget_exhausted/);
});

test("retries reuse the identical payload bytes", () => {
  const entry = {
    id: "e1", launchSessionId: SESSION, externalAnalysisId: "a1",
    targetStatus: "complete" as const, payloadHash: "h",
    payload: '{"stable":true}', state: "pending" as const,
    attempts: 0, nextAttemptAt: NOW.toISOString(),
  };
  const retried = applyDeliveryOutcome(entry, { kind: "retryable", reason: "server_503" }, NOW);
  assert.equal(retried.payload, entry.payload);
  assert.equal(retried.payloadHash, entry.payloadHash);
});

test("HTTP responses classify correctly", () => {
  assert.equal(classifyResponse(200).kind, "acknowledged");
  assert.equal(classifyResponse(409).kind, "permanent");
  assert.equal(classifyResponse(400).kind, "permanent");
  assert.equal(classifyResponse(500).kind, "retryable");
  assert.equal(classifyResponse(503).kind, "retryable");
  assert.equal(classifyResponse(429).kind, "retryable");
});

test("a 409 conflict does not consume the retry budget", () => {
  const entry = {
    id: "e1", launchSessionId: SESSION, externalAnalysisId: "a1",
    targetStatus: "complete" as const, payloadHash: "h", payload: "{}",
    state: "pending" as const, attempts: 0, nextAttemptAt: NOW.toISOString(),
  };
  const updated = applyDeliveryOutcome(entry, classifyResponse(409), NOW);
  assert.equal(updated.state, "failed_permanent");
  assert.equal(updated.lastError, "conflict_409");
});
