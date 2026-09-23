/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E86 cap-rate benchmark route tests. Runs against a real Express app (this
 * router only, no auth/rate-limit middleware — those are applied at the
 * top-level app in src/index.ts and are out of scope for this route's tests)
 * on an ephemeral port, driven with fetch.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import router from "./E86-cap-rate-benchmark.ts";

let server: Server;
let baseUrl: string;

const FORBIDDEN_KEYS = [
  "provenance",
  "sourcesInvestigated",
  "mappedLegacyKey",
  "observationId",
  "sourceId",
  "sourceName",
  "reportTitle",
  "publicationDate",
  "locator",
  "sourceUrl",
  "methodologyNote",
  "sourceSupplied",
];

function assertNoForbiddenKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      assert.ok(
        !FORBIDDEN_KEYS.includes(key),
        `forbidden key "${key}" found at ${path}.${key}`,
      );
      assertNoForbiddenKeys(nested, `${path}.${key}`);
    }
  }
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind ephemeral port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function post(body: unknown) {
  const res = await fetch(`${baseUrl}/market-intelligence/cre/cap-rate-benchmark`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

test("supported Houston/multifamily lookup returns 200 with allow-list DTO", async () => {
  const { status, json } = await post({
    identity: {
      metric: "cap_rate",
      country: "US",
      city: "Houston",
      assetClass: "multifamily",
    },
  });

  assert.equal(status, 200);
  assert.ok(["AVAILABLE", "AVAILABLE_WITH_WARNING"].includes(json.status));
  assert.deepEqual(json.identity, {
    metric: "cap_rate",
    country: "US",
    city: "Houston",
    assetClass: "multifamily",
  });
  assert.ok(Array.isArray(json.warnings));
  assertNoForbiddenKeys(json);
});

test("Miami/multifamily lookup returns 200 DATA_GAP with no fabricated benchmark", async () => {
  const { status, json } = await post({
    identity: {
      metric: "cap_rate",
      country: "US",
      city: "Miami",
      assetClass: "multifamily",
    },
  });

  assert.equal(status, 200);
  assert.equal(json.status, "DATA_GAP");
  assert.equal(json.publisherRange, undefined);
  assert.equal(json.publisherValue, undefined);
  assert.equal(json.derivedBenchmark, undefined);
  assert.ok(json.dataGap);
  assert.equal(typeof json.dataGap.reason, "string");
  assert.equal(typeof json.dataGap.lastResearchDate, "string");
  assertNoForbiddenKeys(json);
});

test("malformed request (invalid enum) returns 400", async () => {
  const { status, json } = await post({
    identity: {
      metric: "cap_rate",
      country: "US",
      city: "Houston",
      assetClass: "not_a_real_asset_class",
    },
  });

  assert.equal(status, 400);
  assert.equal(typeof json.error.message, "string");
});

test("unknown top-level key returns 400", async () => {
  const { status, json } = await post({
    identity: {
      metric: "cap_rate",
      country: "US",
      city: "Houston",
      assetClass: "multifamily",
    },
    unexpectedTopLevelKey: true,
  });

  assert.equal(status, 400);
  assert.equal(typeof json.error.message, "string");
});

test("unknown nested identity key returns 400", async () => {
  const { status, json } = await post({
    identity: {
      metric: "cap_rate",
      country: "US",
      city: "Houston",
      assetClass: "multifamily",
      unexpectedNestedKey: true,
    },
  });

  assert.equal(status, 400);
  assert.equal(typeof json.error.message, "string");
});

test("route source imports only the package-root creIntelligence export", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./E86-cap-rate-benchmark.ts", import.meta.url), "utf8");

  assert.match(source, /from "@investscape\/market-intelligence-engine"/);
  assert.doesNotMatch(source, /@investscape\/market-intelligence-engine\//);
});
