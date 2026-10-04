import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as CALC from "@investscape/calc-engine";

const require = createRequire(import.meta.url);
export const adapter = require("investscape-dev-calc") as {
  PACKAGE_VERSION?: string;
  fullCalculate: (request: unknown, deps: { CALC: unknown; engineIdentity: Record<string, string> }) => Record<string, unknown>;
};
export const ENGINE_MANIFEST = Object.freeze({
  adapterVersion: "0.10.0-p2-6b",
  adapterSourceCheckpoint: "175587843b0aca4ef0d1c9f54ec112962ab24a79",
  adapterArchiveSha256: "0d1f079e121dd16093a08c50b3a025447efed2b9caa420918e2c4ff38502208d",
  calcPackageVersion: "1.0.0",
  calcArchiveSha256: "99a44a41f5c2829ae859375108ca3ec0d7bfef8c047ef7217f853bbd5320ab53",
  artifactVerification: "archive-sha256",
  engineSourceLineage: "UNKNOWN",
});
export const DECLARED_ENGINE_IDENTITY = Object.freeze({
  package: "investscape-calc-engine", version: ENGINE_MANIFEST.calcPackageVersion,
  archiveSha256: ENGINE_MANIFEST.calcArchiveSha256,
});

/** Verify repository artifacts without claiming source lineage or formula correctness. */
export function verifyRuntimeArtifacts(): boolean {
  try {
    for (const [file, expected] of [
      ["investscape-dev-calc-0.10.0-p2-6b.tgz", ENGINE_MANIFEST.adapterArchiveSha256],
      ["investscape-calc-engine-1.0.0.tgz", ENGINE_MANIFEST.calcArchiveSha256],
    ]) {
      const actual = createHash("sha256").update(readFileSync(new URL(`../../vendor/${file}`, import.meta.url))).digest("hex");
      if (actual !== expected) return false;
    }
    const packageJson = require("investscape-dev-calc/package.json");
    return packageJson.version === ENGINE_MANIFEST.adapterVersion;
  } catch { return false; }
}
export function calculateFull(request: unknown): Record<string, unknown> {
  return adapter.fullCalculate(request, { CALC, engineIdentity: DECLARED_ENGINE_IDENTITY });
}
