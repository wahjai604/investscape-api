/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * RFC 8785 canonicalisation and the two event digests (contract v0.3 r3
 * §3.2.1). The JCS vectors are the RFC's own examples; the digest tests pin
 * the exact canonical text by hand, so they do not merely check the code
 * against itself.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalize, JcsError } from "./jcs.ts";
import {
  computeEventDigest,
  computeVersionContentDigest,
  type EventEnvelope,
} from "./eventDigest.ts";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// ---------------------------------------------------------------------------
// RFC 8785
// ---------------------------------------------------------------------------

test("RFC 8785 §3.2.2 example: numbers, strings and literals", () => {
  const input = JSON.parse(
    '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
    '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
    '"literals":[null,true,false]}',
  );
  assert.equal(
    canonicalize(input),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
    '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

test("RFC 8785 §3.2.3 example: members sorted by UTF-16 code units", () => {
  const input = JSON.parse(
    '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh",' +
    '"1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control",' +
    '"\\u00f6":"Latin Small Letter O With Diaeresis"}',
  );
  // Checked on the canonical TEXT: parsing it back would let JavaScript move
  // the integer-like key "1" to the front.
  assert.equal(
    canonicalize(input),
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
    '"ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign",' +
    '"😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
  );
});

test("JCS: nested objects are sorted recursively and whitespace is dropped", () => {
  assert.equal(canonicalize({ b: [3, { z: 1, a: 2 }], a: "x" }), '{"a":"x","b":[3,{"a":2,"z":1}]}');
});

test("JCS: -0 serialises as 0; non-finite numbers and lone surrogates are refused", () => {
  assert.equal(canonicalize(-0), "0");
  assert.throws(() => canonicalize(Number.NaN), JcsError);
  assert.throws(() => canonicalize(Number.POSITIVE_INFINITY), JcsError);
  assert.throws(() => canonicalize("\ud800"), JcsError);
  assert.throws(() => canonicalize({ ["\udc00"]: 1 }), JcsError);
});

test("JCS: strings are not Unicode-normalised", () => {
  // "é" precomposed vs "e" + combining acute: different code points, different text.
  assert.notEqual(canonicalize("é"), canonicalize("é"));
});

// ---------------------------------------------------------------------------
// eventDigest and versionContentDigest
// ---------------------------------------------------------------------------

const BASE: EventEnvelope = {
  eventId: "E7",
  schemaVersion: "investscape.share-grant.changed.v1",
  aggregateKind: "share_grant",
  aggregateId: "g",
  targetState: "revoked",
  version: 5,
  changeSeq: "910",
  occurredAt: "2026-09-28T12:00:00Z",
  payload: { reason: "client_revoked", fields: ["a", "b"] },
};

test("eventDigest is SHA-256 over exactly the §3.2.1 members, correlationId null when absent", () => {
  const expected =
    '{"aggregateId":"g","aggregateKind":"share_grant","changeSeq":"910","correlationId":null,' +
    '"eventId":"E7","occurredAt":"2026-09-28T12:00:00Z",' +
    '"payload":{"fields":["a","b"],"reason":"client_revoked"},' +
    '"schemaVersion":"investscape.share-grant.changed.v1","targetState":"revoked","version":5}';
  assert.equal(computeEventDigest(BASE), sha(expected));
});

test("versionContentDigest binds exactly the authoritative version members", () => {
  const expected =
    '{"aggregateId":"g","aggregateKind":"share_grant","changeSeq":"910",' +
    '"payload":{"fields":["a","b"],"reason":"client_revoked"},' +
    '"schemaVersion":"investscape.share-grant.changed.v1","targetState":"revoked","version":5}';
  assert.equal(computeVersionContentDigest(BASE), sha(expected));
});

test("every envelope member changes eventDigest", () => {
  const base = computeEventDigest(BASE);
  const variants: Partial<EventEnvelope>[] = [
    { eventId: "E7x" }, { schemaVersion: "v2" }, { aggregateKind: "link" }, { aggregateId: "h" },
    { targetState: "active" }, { version: 6 }, { changeSeq: "911" },
    { occurredAt: "2026-09-28T12:00:00.000Z" }, // byte-for-byte, not reparsed
    { correlationId: "c-1" }, { payload: { reason: "client_revoked", fields: ["b", "a"] } },
  ];
  for (const change of variants) {
    assert.notEqual(computeEventDigest({ ...BASE, ...change }), base, JSON.stringify(change));
  }
});

test("versionContentDigest ignores eventId, occurredAt and correlationId only", () => {
  const base = computeVersionContentDigest(BASE);
  // §3.2.1 worked example: E7 re-emitted as E7′ with a new timestamp is an alias.
  assert.equal(
    computeVersionContentDigest({ ...BASE, eventId: "E7-prime", occurredAt: "2026-09-28T12:03:10Z", correlationId: "x" }),
    base,
  );
  const bound: Partial<EventEnvelope>[] = [
    { schemaVersion: "v2" }, { aggregateKind: "link" }, { aggregateId: "h" }, { version: 6 },
    { targetState: "expired" }, { changeSeq: "911" }, { payload: {} },
  ];
  for (const change of bound) {
    assert.notEqual(computeVersionContentDigest({ ...BASE, ...change }), base, JSON.stringify(change));
  }
});

test("payload key order does not change either digest", () => {
  const reordered = { ...BASE, payload: { fields: ["a", "b"], reason: "client_revoked" } };
  assert.equal(computeEventDigest(reordered), computeEventDigest(BASE));
  assert.equal(computeVersionContentDigest(reordered), computeVersionContentDigest(BASE));
});
