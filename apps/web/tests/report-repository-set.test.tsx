import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";

import type { AssessmentReportRepositoryPresentation } from "@lcsp/contracts/assessment-report";

import { ReportRepositorySet } from "../src/features/assessment-runtime/components/molecules/report-repository-set.tsx";
import { copy } from "../src/features/assessment-runtime/utils/conversation-copy.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { render } from "./support/dom.ts";

const digest = `sha256:${"7".repeat(64)}`;

function repository(
  overrides: Partial<AssessmentReportRepositoryPresentation> = {},
): AssessmentReportRepositoryPresentation {
  return {
    repositoryKey: "web",
    ordinal: 0,
    repositoryFullName: "acme/web-app",
    repositorySnapshotId: "snapshot-web",
    repositoryCommit: "a".repeat(40),
    sourcePathPrefix: null,
    sourceScope: {
      mode: "WHOLE_REPOSITORY",
      visibility: "KNOWN_FULL",
      sourcePathPrefix: null,
      excludedPaths: [],
      limitationReasons: [],
      searchCoverageEvidenceIds: [],
    },
    evidenceIds: ["e1", "e2"],
    ...overrides,
  };
}

test("every pinned repository is listed with its own commit, prefix, scope and evidence count", () => {
  setAppLocale("en");
  const view = render(
    <ReportRepositorySet
      repositorySetDigest={digest}
      repositories={[
        repository(),
        repository({
          repositoryKey: "api",
          ordinal: 1,
          repositoryFullName: "acme/billing-api",
          repositoryCommit: "c".repeat(40),
          sourcePathPrefix: "services/billing",
          evidenceIds: ["e3"],
          sourceScope: {
            mode: "SUBTREE",
            visibility: "KNOWN_LIMITED",
            sourcePathPrefix: "services/billing",
            excludedPaths: [],
            limitationReasons: ["PARTIAL_COVERAGE_RECORDED"],
            searchCoverageEvidenceIds: [],
          },
        }),
      ]}
    />,
  );
  const text = view.textContent ?? "";
  assert.ok(text.includes(digest));
  assert.ok(text.includes("web · acme/web-app"));
  assert.ok(text.includes("api · acme/billing-api"));
  assert.ok(text.includes("c".repeat(40)));
  assert.ok(text.includes("services/billing"));
  // A limited repository is not averaged into the other one's full visibility.
  assert.ok(
    text.includes("SUBTREE · KNOWN_LIMITED (PARTIAL_COVERAGE_RECORDED)"),
  );
  assert.ok(text.includes("WHOLE_REPOSITORY · KNOWN_FULL"));
  assert.equal(view.querySelectorAll("li").length, 2);
});

test("the repository set heading is localized", () => {
  setAppLocale("vi");
  const view = render(
    <ReportRepositorySet
      repositorySetDigest={digest}
      repositories={[repository()]}
    />,
  );
  const heading = copy("labels.repositories", {}, "vi");
  assert.notEqual(heading, copy("labels.repositories", {}, "en"));
  assert.ok((view.textContent ?? "").includes(heading));
  setAppLocale("en");
});

test("nothing is rendered without repositories", () => {
  setAppLocale("en");
  const view = render(
    <ReportRepositorySet repositorySetDigest={digest} repositories={[]} />,
  );
  assert.equal(view.querySelector("[data-slot='report-repository-set']"), null);
});
