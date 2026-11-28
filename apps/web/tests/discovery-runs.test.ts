import assert from "node:assert/strict";
import test from "node:test";

import { ASSESSMENT_DISCOVERY_RUN_STATUSES as STATUS } from "@lcsp/contracts/assessment-domain";

import {
  discoveryBatchHasFailure,
  discoveryBatchIsActive,
  selectDiscoveryRun,
} from "../src/features/assessment-runtime/utils/discovery-runs.ts";

const run = (repositoryKey: string | null, status: string) => ({
  repositoryKey,
  status: status as (typeof STATUS)[keyof typeof STATUS],
});

test("a batch is active while any repository scan is queued or running", () => {
  assert.equal(
    discoveryBatchIsActive([
      run("web", STATUS.completed),
      run("api", STATUS.running),
    ]),
    true,
  );
  assert.equal(
    discoveryBatchIsActive([
      run("web", STATUS.queued),
      run("api", STATUS.completed),
    ]),
    true,
  );
  assert.equal(
    discoveryBatchIsActive([
      run("web", STATUS.completed),
      run("api", STATUS.failed),
    ]),
    false,
  );
  assert.equal(discoveryBatchIsActive([]), false);
});

test("one failed repository scan makes the whole discovery retryable", () => {
  assert.equal(
    discoveryBatchHasFailure([
      run("web", STATUS.completed),
      run("api", STATUS.failed),
    ]),
    true,
  );
  assert.equal(discoveryBatchHasFailure([run("web", STATUS.completed)]), false);
});

test("the viewed run is the picked repository, else the primary one", () => {
  const runs = [run("web", STATUS.completed), run("api", STATUS.completed)];
  assert.equal(selectDiscoveryRun(runs, "api")?.repositoryKey, "api");
  assert.equal(selectDiscoveryRun(runs, null)?.repositoryKey, "web");
  // A pick that is no longer part of the batch falls back to the primary repository.
  assert.equal(selectDiscoveryRun(runs, "mobile")?.repositoryKey, "web");
  assert.equal(selectDiscoveryRun([], "api"), null);
  // A legacy run without a key is still viewable as the sole run.
  assert.equal(
    selectDiscoveryRun([run(null, STATUS.completed)], null)?.repositoryKey,
    null,
  );
});
