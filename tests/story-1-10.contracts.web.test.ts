import * as assert from "node:assert/strict";
import { test } from "node:test";

import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES, type ProblemResult } from "@lcsp/contracts/auth";
import { REPOSITORY_CONNECTION_STATUSES } from "@lcsp/contracts/github-integration";
import { OUTBOX_STATUSES } from "@lcsp/contracts/outbox";

type Assert<T extends true> = T;
type _ApiProblemIsAcceptedByWebWireContract = Assert<
  ProblemResult extends { ok: false; problem: object } ? true : false
>;

test("shared contracts expose resource-local value sets", () => {
  assert.deepEqual(Object.values(OUTBOX_STATUSES), [
    "PENDING",
    OUTBOX_STATUSES.ownedPending,
    "PUBLISHED",
    "FAILED",
    "DLQ",
    OUTBOX_STATUSES.cancelled,
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
