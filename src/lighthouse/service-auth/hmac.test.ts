/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * HMAC service-auth contract tests.
 *
 * The golden vector below is lifted verbatim from the Relationship OS test
 * `tests/service-auth-v0.2.test.mjs` on `origin/feature/investscape-launch-v0.1`.
 * Signing that exact input must produce that exact signature, so this pins us
 * to the producer's OBSERVED behaviour rather than to prose. If either side
 * changes canonicalization, this fails loudly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_HEADERS,
  canonicalString,
  generateNonce,
  signRequest,
  verifyRequest,
} from "./hmac.ts";

// --- Golden vector (Relationship OS fixture) --------------------------------
const PATH = "/v1/investscape/launch-sessions/redeem";
const RAW_BODY =
  '{"launchSessionId":"11111111-2222-3333-4444-555555555555","code":"opaque"}';
const NOW = 1787920000;
const NONCE = "a".repeat(32);
const KEY_ID = "key-1";
const SECRET = "secret-1";
const SERVICE = "investscape";
const GOLDEN_SIGNATURE =
  "ea1f9fa51285b52408c5a188e909dc93d58b41e89393323f274509bfbd3ffcf3";
const GOLDEN_BODY_HASH =
  "f644b932c68e3f4f0713e2e63d266d1f4dbd485374afcdb5612d489a2dbaae54";

const secrets = { [KEY_ID]: SECRET };
const now = () => NOW;

function signedHeaders(overrides: Record<string, string> = {}) {
  return {
    ...signRequest({
      serviceName: SERVICE,
      keyId: KEY_ID,
      secret: SECRET,
      method: "POST",
      path: PATH,
      rawBody: RAW_BODY,
      now,
      nonce: NONCE,
    }),
    ...overrides,
  };
}

function verify(headers: Record<string, string>, rawBody = RAW_BODY) {
  return verifyRequest({
    headers,
    method: "POST",
    path: PATH,
    rawBody,
    expectedService: SERVICE,
    secrets,
    now,
  });
}

test("canonical string matches the Relationship OS layout", () => {
  const base = canonicalString({
    method: "POST",
    path: PATH,
    timestamp: String(NOW),
    nonce: NONCE,
    rawBody: RAW_BODY,
  });
  assert.equal(base, `POST\n${PATH}\n${NOW}\n${NONCE}\n${GOLDEN_BODY_HASH}`);
});

test("signRequest reproduces the producer's golden signature byte for byte", () => {
  const headers = signedHeaders();
  assert.equal(headers[SERVICE_HEADERS.signature], GOLDEN_SIGNATURE);
  assert.equal(headers[SERVICE_HEADERS.service], SERVICE);
  assert.equal(headers[SERVICE_HEADERS.keyId], KEY_ID);
  assert.equal(headers[SERVICE_HEADERS.timestamp], String(NOW));
  assert.equal(headers[SERVICE_HEADERS.nonce], NONCE);
});

test("signRequest emits the x-lighthouse- header names, not x-service-", () => {
  const headers = signedHeaders();
  const names = Object.keys(headers);
  assert.ok(names.every((n) => n.startsWith("x-lighthouse-")), names.join(","));
  assert.ok(!names.some((n) => n.startsWith("x-service-")));
});

test("the shared secret never appears in the produced headers", () => {
  const serialised = JSON.stringify(signedHeaders());
  assert.ok(!serialised.includes(SECRET));
});

test("generateNonce produces >=32 lowercase hex characters and does not repeat", () => {
  const a = generateNonce();
  const b = generateNonce();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("a correctly signed request verifies", () => {
  const result = verify(signedHeaders());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.keyId, KEY_ID);
    assert.equal(result.nonce, NONCE);
    assert.equal(result.timestamp, NOW);
  }
});

test("a tampered body fails verification", () => {
  const result = verify(signedHeaders(), RAW_BODY.replace("opaque", "forged"));
  assert.deepEqual(result, { ok: false, reason: "SIGNATURE_MISMATCH" });
});

test("a tampered path fails verification", () => {
  const result = verifyRequest({
    headers: signedHeaders(),
    method: "POST",
    path: "/v1/investscape/launch-sessions/redeem-evil",
    rawBody: RAW_BODY,
    expectedService: SERVICE,
    secrets,
    now,
  });
  assert.deepEqual(result, { ok: false, reason: "SIGNATURE_MISMATCH" });
});

test("a zeroed signature fails, matching the producer's own case", () => {
  const result = verify(
    signedHeaders({ [SERVICE_HEADERS.signature]: "0".repeat(64) }),
  );
  assert.deepEqual(result, { ok: false, reason: "SIGNATURE_MISMATCH" });
});

test("timestamp skew of 301s is rejected, matching the producer's boundary", () => {
  const stale = signRequest({
    serviceName: SERVICE, keyId: KEY_ID, secret: SECRET,
    method: "POST", path: PATH, rawBody: RAW_BODY,
    now: () => NOW - 301, nonce: NONCE,
  });
  assert.deepEqual(verify(stale), { ok: false, reason: "TIMESTAMP_OUT_OF_RANGE" });
});

test("timestamp skew of exactly 300s is accepted", () => {
  const edge = signRequest({
    serviceName: SERVICE, keyId: KEY_ID, secret: SECRET,
    method: "POST", path: PATH, rawBody: RAW_BODY,
    now: () => NOW - 300, nonce: NONCE,
  });
  assert.equal(verify(edge).ok, true);
});

test("empty headers fail closed, matching the producer's own case", () => {
  assert.deepEqual(verify({}), { ok: false, reason: "MISSING_HEADERS" });
});

test("a mismatched service name fails closed", () => {
  const result = verify(
    signedHeaders({ [SERVICE_HEADERS.service]: "relationship_os" }),
  );
  assert.deepEqual(result, { ok: false, reason: "SERVICE_MISMATCH" });
});

test("an unknown key id fails closed", () => {
  const result = verify(signedHeaders({ [SERVICE_HEADERS.keyId]: "key-99" }));
  assert.deepEqual(result, { ok: false, reason: "UNKNOWN_KEY_ID" });
});

test("a malformed nonce fails closed", () => {
  const short = signRequest({
    serviceName: SERVICE, keyId: KEY_ID, secret: SECRET,
    method: "POST", path: PATH, rawBody: RAW_BODY, now, nonce: "abc",
  });
  assert.deepEqual(verify(short), { ok: false, reason: "MALFORMED_NONCE" });
});

test("a non-integer timestamp fails closed", () => {
  const result = verify(
    signedHeaders({ [SERVICE_HEADERS.timestamp]: "not-a-number" }),
  );
  assert.deepEqual(result, { ok: false, reason: "MALFORMED_TIMESTAMP" });
});

test("a malformed signature fails closed before any comparison", () => {
  const result = verify(signedHeaders({ [SERVICE_HEADERS.signature]: "zzz" }));
  assert.deepEqual(result, { ok: false, reason: "MALFORMED_SIGNATURE" });
});

test("duplicated header values are rejected rather than coerced", () => {
  const result = verifyRequest({
    headers: { ...signedHeaders(), [SERVICE_HEADERS.nonce]: [NONCE, NONCE] },
    method: "POST", path: PATH, rawBody: RAW_BODY,
    expectedService: SERVICE, secrets, now,
  });
  assert.deepEqual(result, { ok: false, reason: "MISSING_HEADERS" });
});
