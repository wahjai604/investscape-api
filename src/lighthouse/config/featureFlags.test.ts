/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIGHTHOUSE_FEATURE_FLAGS,
  envVarNameFor,
  featureFlagSnapshot,
  isFeatureEnabled,
  isKnownFeatureFlag,
} from "./featureFlags.ts";

test("every feature flag defaults to disabled with empty configuration", () => {
  const snapshot = featureFlagSnapshot({});
  for (const flag of LIGHTHOUSE_FEATURE_FLAGS) {
    assert.equal(snapshot[flag], false, `${flag} must default to disabled`);
  }
});

test("every feature flag defaults to disabled against the real process env", () => {
  // Guards against a stray LIGHTHOUSE_FF_* being set in a developer shell or
  // committed .env and silently enabling a foundation flow.
  const snapshot = featureFlagSnapshot();
  for (const flag of LIGHTHOUSE_FEATURE_FLAGS) {
    assert.equal(snapshot[flag], false, `${flag} is enabled in this environment`);
  }
});

test("the required flag set from the handoff prompt is present", () => {
  for (const required of [
    "lighthouse.cross_product_identity_linking",
    "lighthouse.client_workspace_disclosure",
    "lighthouse.selected_analysis_sharing",
    "lighthouse.professional_connectivity_projection",
    "lighthouse.lifecycle_synchronization",
    "lighthouse.cross_product_administration",
    "lighthouse.delegated_portfolio_management",
    "lighthouse.assisted_consent",
    "lighthouse.suite_entitlement_sync",
  ]) {
    assert.ok(isKnownFeatureFlag(required), `missing flag: ${required}`);
  }
});

test("an unknown flag name fails closed rather than throwing", () => {
  assert.equal(isFeatureEnabled("lighthouse.not_a_real_flag", {}), false);
  assert.equal(
    isFeatureEnabled("lighthouse.not_a_real_flag", {
      LIGHTHOUSE_FF_NOT_A_REAL_FLAG: "true",
    }),
    false,
  );
});

test("exactly 'true' enables; near-misses do not", () => {
  const flag = "lighthouse.selected_analysis_sharing";
  const name = envVarNameFor(flag);
  assert.equal(isFeatureEnabled(flag, { [name]: "true" }), true);
  assert.equal(isFeatureEnabled(flag, { [name]: "TRUE" }), true);
  assert.equal(isFeatureEnabled(flag, { [name]: "  true  " }), true);

  for (const sloppy of ["1", "yes", "on", "enabled", "True!", "", "false", "0"]) {
    assert.equal(
      isFeatureEnabled(flag, { [name]: sloppy }),
      false,
      `"${sloppy}" must not enable a flag`,
    );
  }
});

test("env var naming is stable and namespaced", () => {
  assert.equal(
    envVarNameFor("lighthouse.delegated_portfolio_management"),
    "LIGHTHOUSE_FF_DELEGATED_PORTFOLIO_MANAGEMENT",
  );
});

test("enabling one flag does not enable any other", () => {
  const snapshot = featureFlagSnapshot({
    LIGHTHOUSE_FF_SELECTED_ANALYSIS_SHARING: "true",
  });
  assert.equal(snapshot["lighthouse.selected_analysis_sharing"], true);
  const others = LIGHTHOUSE_FEATURE_FLAGS.filter(
    (f) => f !== "lighthouse.selected_analysis_sharing",
  );
  for (const flag of others) {
    assert.equal(snapshot[flag], false, `${flag} leaked on`);
  }
});
