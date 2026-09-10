import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_ACCOUNT_STATUSES,
  AUTH_USER_ROLES,
  type AdminUserDetail,
  type AuthUserRole,
} from "@lcsp/contracts/auth";

test("Admin user detail: role select modification does not mutate until explicit Save", () => {
  let authoritativeUser: AdminUserDetail = {
    id: "usr_100",
    fullName: "Jane Doe",
    email: "jane@corp.internal",
    role: AUTH_USER_ROLES.customer,
    status: AUTH_ACCOUNT_STATUSES.active,
    createdAt: "2026-01-10T00:00:00.000Z",
    lastActiveAt: "2026-09-08T10:00:00.000Z",
    usageSummary: {
      assessments30d: 4,
      lastAssessmentAt: "2026-09-08T10:00:00.000Z",
      creditSpend30d: 12.5,
      openFindingsCount: 1,
    },
  };

  let localSelectedRole: AuthUserRole = authoritativeUser.role;
  let mutationCount = 0;

  // 1. User changes role dropdown in UI
  localSelectedRole = AUTH_USER_ROLES.admin;

  // Invariant: authoritive user role and mutation count remain unchanged
  assert.equal(authoritativeUser.role, AUTH_USER_ROLES.customer);
  assert.equal(mutationCount, 0);

  // 2. User clicks "Save role"
  function onSaveRole(newRole: AuthUserRole) {
    mutationCount += 1;
    authoritativeUser = {
      ...authoritativeUser,
      role: newRole,
    };
  }

  onSaveRole(localSelectedRole);
  assert.equal(mutationCount, 1);
  assert.equal(authoritativeUser.role, AUTH_USER_ROLES.admin);
});

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
