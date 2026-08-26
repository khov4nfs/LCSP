import { test } from "node:test";
import * as assert from "node:assert/strict";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { canCreateAssessment } from "@lcsp/web";

test("Story 1.6 uses canonical role-only authorization", () => {
  assert.deepEqual(Object.values(AUTH_USER_ROLES), ["ADMIN", "CUSTOMER"]);
});

test("Story 1.6 exposes assessment creation only to CUSTOMER", () => {
  assert.equal(canCreateAssessment(AUTH_USER_ROLES.customer), true);
  assert.equal(canCreateAssessment(AUTH_USER_ROLES.admin), false);
});
