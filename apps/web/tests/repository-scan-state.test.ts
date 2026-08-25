import * as assert from "node:assert/strict";
import { test } from "node:test";

import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

import { isRepositoryScanJobActive } from "../src/features/evidence/utils/repository-scan-state.ts";

test("repository scan stays active until backend emits a terminal status", () => {
  assert.equal(
    isRepositoryScanJobActive(REPOSITORY_SCAN_JOB_STATUSES.queued),
    true,
  );
  assert.equal(
    isRepositoryScanJobActive(REPOSITORY_SCAN_JOB_STATUSES.running),
    true,
  );

  for (const status of [
    REPOSITORY_SCAN_JOB_STATUSES.completed,
    REPOSITORY_SCAN_JOB_STATUSES.failed,
    REPOSITORY_SCAN_JOB_STATUSES.blocked,
    REPOSITORY_SCAN_JOB_STATUSES.blockedMapping,
    REPOSITORY_SCAN_JOB_STATUSES.pendingMapping,
    REPOSITORY_SCAN_JOB_STATUSES.waitingForContext,
    REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot,
  ]) {
    assert.equal(isRepositoryScanJobActive(status), false);
  }
});
