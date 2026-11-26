import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";

import { ASSESSMENT_DISCOVERY_RUN_STATUSES as STATUS } from "@lcsp/contracts/assessment-domain";
import type { AssessmentDiscoveryRunView } from "@lcsp/contracts/assessment-domain";

import { DiscoveryRepositoryProgress } from "../src/features/assessment-runtime/components/molecules/discovery-repository-progress.tsx";
import { copy } from "../src/features/assessment-runtime/utils/conversation-copy.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { byText, click, render } from "./support/dom.ts";

function run(
  repositoryKey: string,
  status: AssessmentDiscoveryRunView["status"],
  index: number,
): AssessmentDiscoveryRunView {
  return {
    runId: `00000000-0000-4000-8000-00000000000${index}`,
    assessmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status,
    attempt: 1,
    repositoryKey,
    discoveryBatchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    repositorySnapshotId: `snapshot-${repositoryKey}`,
    repositoryCommit: "a".repeat(40),
    sourcePathPrefix: null,
    requestedAt: "2026-11-26T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    discovery: { available: false, discovery: null },
  };
}

test("each repository shows its own scan status and lets the customer pick whose results to view", () => {
  setAppLocale("en");
  const picked: string[] = [];
  const view = render(
    <DiscoveryRepositoryProgress
      runs={[run("web", STATUS.completed, 1), run("api", STATUS.running, 2)]}
      viewedKey="web"
      onView={(key) => picked.push(key)}
    />,
  );
  const web = byText<HTMLButtonElement>(
    view,
    "button",
    `web · ${copy("ruleAudit.discovery.statusCompleted")}`,
  );
  const api = byText<HTMLButtonElement>(
    view,
    "button",
    `api · ${copy("ruleAudit.discovery.statusRunning")}`,
  );
  assert.ok(web && api);
  assert.equal(web.getAttribute("aria-pressed"), "true");
  assert.equal(api.getAttribute("aria-pressed"), "false");
  click(api);
  assert.deepEqual(picked, ["api"]);
});

test("a single repository run shows no repository picker", () => {
  setAppLocale("en");
  const view = render(
    <DiscoveryRepositoryProgress
      runs={[run("web", STATUS.completed, 1)]}
      viewedKey="web"
      onView={() => undefined}
    />,
  );
  assert.equal(
    view.querySelector("[data-slot='discovery-repository-progress']"),
    null,
  );
});

test("the repository labels are localized", () => {
  setAppLocale("vi");
  const view = render(
    <DiscoveryRepositoryProgress
      runs={[run("web", STATUS.failed, 1), run("api", STATUS.queued, 2)]}
      viewedKey="web"
      onView={() => undefined}
    />,
  );
  assert.ok(
    view.textContent?.includes(
      copy("ruleAudit.discovery.statusFailed", {}, "vi"),
    ),
  );
  assert.notEqual(
    copy("ruleAudit.discovery.statusFailed", {}, "vi"),
    copy("ruleAudit.discovery.statusFailed", {}, "en"),
  );
  setAppLocale("en");
});
