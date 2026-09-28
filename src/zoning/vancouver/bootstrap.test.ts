/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 *
 * E85 — the Vancouver spatial startup switch. HERMETIC: the loader is injected,
 * so no evidence folder is read. Loader integrity is covered separately
 * (snapshotLoader.synthetic.test.ts, snapshotLoader.test.ts).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapVancouverSpatialEvidence,
  describeVancouverSpatialBoot,
  VancouverSpatialBootConfigError,
  VANCOUVER_EVIDENCE_DIR_ENV,
  VANCOUVER_SPATIAL_ENABLED_ENV,
  type VancouverSpatialLoader,
} from "./bootstrap.ts";
import { VancouverSpatialEvidenceError, type VancouverSpatialEvidence } from "./snapshotLoader.ts";
import { VANCOUVER_SPATIAL_MANIFEST } from "./spatialManifest.ts";
import { VANCOUVER_LEGAL_PACK } from "./legalPack.ts";

/** A loader that records its calls and returns a SYNTHETIC evidence object. */
function spyLoader(result?: VancouverSpatialEvidence): { load: VancouverSpatialLoader; calls: string[] } {
  const calls: string[] = [];
  const evidence =
    result ??
    ({
      manifest: VANCOUVER_SPATIAL_MANIFEST,
      legalPack: VANCOUVER_LEGAL_PACK,
      summary: { featureCount: 2 },
      timings: { totalMs: 1 },
    } as unknown as VancouverSpatialEvidence);
  return {
    calls,
    load: ({ evidenceDir }) => {
      calls.push(evidenceDir);
      return evidence;
    },
  };
}

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => ({ ...vars });

describe("E85 Vancouver spatial bootstrap — disabled unless the switch is \"true\"", () => {
  test("disabled with no switch and no path: the loader is never called", () => {
    const spy = spyLoader();
    const s = bootstrapVancouverSpatialEvidence(env({}), spy.load);
    assert.equal(s.state, "disabled");
    assert.deepEqual(spy.calls, []);
    assert.match(describeVancouverSpatialBoot(s), /disabled .* no zoning route mounted/);
  });

  test("disabled with a (stale) path configured: the path is ignored and the loader is never called", () => {
    const spy = spyLoader();
    const s = bootstrapVancouverSpatialEvidence(env({ [VANCOUVER_EVIDENCE_DIR_ENV]: "/stale/railway/path" }), spy.load);
    assert.equal(s.state, "disabled");
    assert.deepEqual(spy.calls, []);
    assert.equal(s.state === "disabled" && s.reason.includes("set but ignored"), true);
  });

  test("the switch set to \"\" or \"false\" is disabled, even with a path", () => {
    for (const flag of ["", "false"]) {
      const spy = spyLoader();
      const s = bootstrapVancouverSpatialEvidence(env({ [VANCOUVER_SPATIAL_ENABLED_ENV]: flag, [VANCOUVER_EVIDENCE_DIR_ENV]: "/some/path" }), spy.load);
      assert.equal(s.state, "disabled", `flag ${JSON.stringify(flag)}`);
      assert.deepEqual(spy.calls, []);
    }
  });

  test("any other switch value is refused at startup, not guessed", () => {
    for (const flag of ["TRUE", "1", "yes", " true"]) {
      const spy = spyLoader();
      assert.throws(() => bootstrapVancouverSpatialEvidence(env({ [VANCOUVER_SPATIAL_ENABLED_ENV]: flag, [VANCOUVER_EVIDENCE_DIR_ENV]: "/p" }), spy.load), VancouverSpatialBootConfigError);
      assert.deepEqual(spy.calls, []);
    }
  });
});

describe("E85 Vancouver spatial bootstrap — enabled fails closed", () => {
  test("enabled with a blank path (unset, empty or whitespace) throws a config error; the loader is never called", () => {
    for (const dir of [undefined, "", "   "]) {
      const spy = spyLoader();
      const vars: Record<string, string> = { [VANCOUVER_SPATIAL_ENABLED_ENV]: "true" };
      if (dir !== undefined) vars[VANCOUVER_EVIDENCE_DIR_ENV] = dir;
      assert.throws(() => bootstrapVancouverSpatialEvidence(env(vars), spy.load), (e: unknown) => e instanceof VancouverSpatialBootConfigError && /blank/.test(e.message), `dir ${JSON.stringify(dir)}`);
      assert.deepEqual(spy.calls, []);
    }
  });

  test("enabled with a path and a successful loader: verified, with the loader called once on that path", () => {
    const spy = spyLoader();
    const s = bootstrapVancouverSpatialEvidence(env({ [VANCOUVER_SPATIAL_ENABLED_ENV]: "true", [VANCOUVER_EVIDENCE_DIR_ENV]: "/evidence" }), spy.load);
    assert.equal(s.state, "verified");
    assert.deepEqual(spy.calls, ["/evidence"]);
    const line = describeVancouverSpatialBoot(s);
    assert.match(line, /verified .*features=2/);
    assert.match(line, /no zoning route mounted, PID lookup unavailable/);
    assert.match(line, /PACKAGED_NOT_RELEASED/);
  });

  test("enabled when the loader throws: the loader's error propagates unchanged (startup stops)", () => {
    const failure = new VancouverSpatialEvidenceError("HASH_MISMATCH", "expected sha256 a, found b");
    const load: VancouverSpatialLoader = () => {
      throw failure;
    };
    assert.throws(() => bootstrapVancouverSpatialEvidence(env({ [VANCOUVER_SPATIAL_ENABLED_ENV]: "true", [VANCOUVER_EVIDENCE_DIR_ENV]: "/evidence" }), load), (e: unknown) => e === failure);
  });
});
