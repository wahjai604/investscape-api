/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * E85 — legal-pack verifier: fails closed on PDF bytes and on fact-set or
 * identity drift, and never turns a match into a release. Also pins that the
 * vendored engine (0.3.0) cannot claim E85 support.
 *
 * SYNTHETIC: the temp-folder PDFs and the manifest built from this API's own
 * pins. The real pinned PDFs are hashed when the evidence folder is present,
 * and the sibling engine's manifest source is read (as text) to prove the pins
 * agree; no engine test fixture is imported.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VANCOUVER_LEGAL_PACK } from "./legalPack.ts";
import { hashVancouverLegalPackPdfs, verifyEngineLegalPackManifest, VancouverLegalPackEvidenceError, type EngineLegalPackManifestLike } from "./legalPackVerifier.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(here, "../../../../e85-pilot-evidence");
const ENGINE_MANIFEST_TS = path.resolve(here, "../../../../investscape-market-intelligence-engine/src/zoning-land-use-engine/adapters/vancouver/legal-pack/manifest.ts");
const API_ROOT = path.resolve(here, "../../..");

const codesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof VancouverLegalPackEvidenceError, String(e));
    return e.problems.map((p) => p.code);
  }
  assert.fail("expected VancouverLegalPackEvidenceError");
};

/** SYNTHETIC engine manifest built from this API's pins. */
function pinnedManifest(): EngineLegalPackManifestLike {
  return {
    legalPackId: VANCOUVER_LEGAL_PACK.legalPackId,
    jurisdictionId: VANCOUVER_LEGAL_PACK.jurisdictionId,
    releaseStatus: "NOT_RELEASED",
    asOfResolution: "DISABLED",
    sources: VANCOUVER_LEGAL_PACK.sources.map((s) => ({
      zoneDesignation: s.zone,
      sourceId: s.sourceId,
      sourceVersionId: s.sourceVersionId,
      sourcePdfSha256: s.pdfSha256,
      adapterId: s.adapterId,
      adapterVersion: s.adapterVersion,
      factIds: Array.from({ length: s.structuredFactCount }, (_, i) => `synthetic-${i}`),
      factSetSha256: s.factSetSha256,
    })),
  };
}

describe("hashVancouverLegalPackPdfs — fails closed on bytes", () => {
  test("missing PDFs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e85-pack-"));
    assert.deepEqual(codesOf(() => hashVancouverLegalPackPdfs(dir)), ["PDF_MISSING", "PDF_MISSING"]);
  });

  test("PDFs whose bytes differ from the pins (synthetic bytes)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e85-pack-"));
    for (const s of VANCOUVER_LEGAL_PACK.sources) {
      mkdirSync(path.dirname(path.join(dir, s.evidencePath)), { recursive: true });
      writeFileSync(path.join(dir, s.evidencePath), `synthetic, not the ${s.zone} schedule`);
    }
    assert.deepEqual(codesOf(() => hashVancouverLegalPackPdfs(dir)), ["PDF_HASH_MISMATCH", "PDF_HASH_MISMATCH"]);
  });

  test("the real pinned PDFs hash to the pins", { skip: !existsSync(path.join(EVIDENCE_DIR, VANCOUVER_LEGAL_PACK.sources[0].evidencePath)) && "evidence folder not present" }, () => {
    const observed = hashVancouverLegalPackPdfs(EVIDENCE_DIR);
    for (const s of VANCOUVER_LEGAL_PACK.sources) assert.equal(observed.get(s.sourceId), s.pdfSha256);
  });
});

describe("verifyEngineLegalPackManifest — fails closed on identity, fact set and release claims", () => {
  test("a matching manifest verifies, and the posture still serves nothing", () => {
    const p = verifyEngineLegalPackManifest(pinnedManifest());
    assert.deepEqual(p, { legalPackId: VANCOUVER_LEGAL_PACK.legalPackId, status: "PACKAGED_NOT_RELEASED", releaseStatus: "NOT_RELEASED", asOfResolution: "DISABLED", servesDecisions: false, publicReady: false });
  });

  test("fact-set drift", () => {
    const m = pinnedManifest();
    const bad = { ...m, sources: m.sources.map((s, i) => (i === 1 ? { ...s, factSetSha256: "f".repeat(64), factIds: s.factIds.slice(1) } : s)) };
    assert.deepEqual(codesOf(() => verifyEngineLegalPackManifest(bad)), ["FACT_SET_MISMATCH", "FACT_SET_MISMATCH"]);
  });

  test("PDF, version or adapter drift", () => {
    const m = pinnedManifest();
    const bad = { ...m, sources: m.sources.map((s, i) => (i === 0 ? { ...s, sourcePdfSha256: "0".repeat(64), adapterVersion: "1.0.0", sourceVersionId: "2026-09-consolidation" } : s)) };
    assert.deepEqual(codesOf(() => verifyEngineLegalPackManifest(bad)), ["IDENTITY_MISMATCH", "IDENTITY_MISMATCH", "IDENTITY_MISMATCH"]);
  });

  test("a manifest claiming release or AS_OF resolution is refused, not honoured", () => {
    assert.deepEqual(codesOf(() => verifyEngineLegalPackManifest({ ...pinnedManifest(), releaseStatus: "RELEASED", asOfResolution: "ENABLED" })), ["UNEXPECTED_RELEASE_CLAIM", "UNEXPECTED_RELEASE_CLAIM"]);
  });

  test("the pins agree with the engine's committed-or-working manifest source", { skip: !existsSync(ENGINE_MANIFEST_TS) && "engine repo not beside this API" }, () => {
    const src = readFileSync(ENGINE_MANIFEST_TS, "utf8");
    for (const s of VANCOUVER_LEGAL_PACK.sources) {
      for (const pin of [s.sourceId, s.sourceVersionId, s.pdfSha256, s.factSetSha256, s.adapterId]) assert.ok(src.includes(`"${pin}"`), `${s.zone}: engine manifest lacks ${pin}`);
      const block = src.slice(src.indexOf(`sourceId: "${s.sourceId}"`));
      assert.match(block.slice(0, block.indexOf("factSetSha256")), new RegExp(`adapterVersion: "${s.adapterVersion.replace(/\./g, "\\.")}"`));
    }
    assert.match(src, /releaseStatus: "NOT_RELEASED"/);
    assert.match(src, /asOfResolution: "DISABLED"/);
  });
});

describe("vendored engine 0.3.0 cannot claim E85", () => {
  // The package's exports map hides package.json, so read it from node_modules.
  const pkgDir = path.join(API_ROOT, "node_modules", "@investscape", "market-intelligence-engine");
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as { version: string; files: string[]; exports: Record<string, unknown> };

  test("version is 0.3.0 with a single root export and no zoning files", () => {
    assert.equal(pkg.version, "0.3.0");
    assert.deepEqual(Object.keys(pkg.exports), ["."]);
    assert.ok(!pkg.files.some((f) => /zoning|e85/i.test(f)), "package files list zoning");
    assert.ok(!readdirSync(path.join(pkgDir, "dist")).some((f) => /zoning/i.test(f)), "dist ships zoning");
  });

  test("the runtime export surface has no zoning / E85 / legal-pack name", async () => {
    const mod = (await import("@investscape/market-intelligence-engine")) as Record<string, unknown>;
    const names = Object.keys(mod).filter((k) => /zoning|e85|legalpack|landuse/i.test(k));
    assert.deepEqual(names, []);
  });

  test("no API source imports an E85 public entry point or mounts a zoning route", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
          // Code only: comments may name the engine functions this API will call later.
          const src = readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
          if (/zoningLandUse|evaluateE85PublicRequest|parseE85PublicRequest|assembleVancouverLegalPackForServer/.test(src)) hits.push(`${full}: E85 entry point`);
          if (/\.(post|get|use)\(\s*["'`][^"'`]*zoning/i.test(src)) hits.push(`${full}: zoning route`);
        }
      }
    };
    walk(path.join(API_ROOT, "src"));
    assert.deepEqual(hits, []);
  });
});
