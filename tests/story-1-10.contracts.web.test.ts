import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES, type ProblemResult } from "@lcsp/contracts/auth";
import { REPOSITORY_CONNECTION_STATUSES } from "@lcsp/contracts/github-integration";
import { OUTBOX_STATUSES } from "@lcsp/contracts/outbox";

type Assert<T extends true> = T;
type _ApiProblemIsAcceptedByWebWireContract = Assert<
  ProblemResult extends { ok: false; problem: object } ? true : false
>;

test("shared contracts expose canonical workflow value sets", () => {
  assert.deepEqual(Object.values(ASSESSMENT_STATUS_CODES), [
    "WIZARD_IN_PROGRESS",
    "WIZARD_SUBMITTED",
    "EVIDENCE_REQUIRED",
    "SCAN_IN_PROGRESS",
    "CLASSIFICATION_LOCKED",
    "READY_FOR_REVIEW",
  ]);
  assert.deepEqual(Object.values(WIZARD_STATUS_CODES), [
    "NOT_STARTED",
    "IN_PROGRESS",
    "SUBMITTED",
  ]);
  assert.deepEqual(Object.values(OUTBOX_STATUSES), [
    "PENDING",
    "PUBLISHED",
    "FAILED",
    "DLQ",
  ]);
  assert.deepEqual(Object.values(REPOSITORY_CONNECTION_STATUSES), [
    "ACTIVE",
    "REVOKED",
  ]);
});

test("decision and role contracts have canonical sources", () => {
  assert.deepEqual(Object.values(AUDIT_DECISIONS), ["ALLOW", "DENY"]);
  assert.deepEqual(Object.values(AUTH_USER_ROLES), ["ADMIN", "CUSTOMER"]);
});
