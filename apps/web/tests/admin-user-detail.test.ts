import assert from "node:assert/strict";
import test from "node:test";

import { type AdminUserDetail } from "@lcsp/contracts/auth";

test("Admin user detail: unavailable usage summary metrics format as em dash, never zero", () => {
  const partialUsage: AdminUserDetail["usageSummary"] = {
    assessments30d: null,
    lastAssessmentAt: null,
    creditSpend30d: null,
    openFindingsCount: null,
  };

  function formatUsageMetric(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return "—";
    }
    return String(value);
  }

  assert.equal(formatUsageMetric(partialUsage.assessments30d), "—");
  assert.equal(formatUsageMetric(partialUsage.creditSpend30d), "—");
  assert.equal(formatUsageMetric(partialUsage.openFindingsCount), "—");
  assert.notEqual(formatUsageMetric(partialUsage.assessments30d), "0");

  const zeroUsage: AdminUserDetail["usageSummary"] = {
    assessments30d: 0,
    lastAssessmentAt: null,
    creditSpend30d: 0,
    openFindingsCount: 0,
  };

  assert.equal(formatUsageMetric(zeroUsage.assessments30d), "0");
  assert.equal(formatUsageMetric(zeroUsage.openFindingsCount), "0");
});
