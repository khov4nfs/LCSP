import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";

import {
  TRACKING_FRESHNESS_STATUSES,
  assessmentRepositorySetupSchema,
  type CustomerTrackingAssessmentItem,
} from "@lcsp/contracts/assessment-domain";

import { ConversationOpeningTurn } from "../src/features/assessment-runtime/components/molecules/conversation-opening-turn.tsx";
import { EvidenceRelationshipViewer } from "../src/features/assessment-runtime/components/molecules/evidence-relationship-viewer.tsx";
import { RepositoryPinList } from "../src/features/assessment-runtime/components/molecules/repository-pin-list.tsx";
import { CONVERSATION_TURN_KINDS } from "../src/features/assessment-runtime/types/conversation.types.ts";
import { repositoryPinViews } from "../src/features/assessment-runtime/utils/repository-pins.ts";
import { TrackingRepositoryList } from "../src/features/tracking/components/molecules/tracking-repository-list.tsx";
import { setAppLocale } from "../src/lib/locale.ts";
import { render } from "./support/dom.ts";

const connection = (repositoryFullName: string, id: string) => ({
  connectionId: id,
  provider: "GITHUB",
  repositoryId: `repo-${id}`,
  repositoryFullName,
  defaultBranch: "main",
  status: "ACTIVE",
});
const snapshot = (
  id: string,
  commitSha: string,
  sourcePathPrefix: string | null,
) => ({
  id,
  assessmentId: "11111111-1111-4111-8111-111111111111",
  connectionId: `connection-${id}`,
  provider: "GITHUB",
  repositoryFullName: "acme/any",
  branch: "main",
  commitSha,
  sourcePathPrefix,
  createdAt: "2026-11-27T00:00:00.000Z",
});

function setupOf(overrides: Record<string, unknown> = {}) {
  return assessmentRepositorySetupSchema.parse({
    assessmentId: "11111111-1111-4111-8111-111111111111",
    lifecycle: null,
    connection: null,
    snapshot: null,
    scanJob: null,
    ...overrides,
  });
}

test("repository pins list a set in pin order, each with its own commit and prefix", () => {
  const setup = setupOf({
    repositories: [
      {
        repositoryKey: "web",
        connection: connection("acme/web", "c1"),
        snapshot: snapshot("s1", "a".repeat(40), null),
        scanJob: null,
      },
      {
        repositoryKey: "api",
        connection: connection("acme/api", "c2"),
        snapshot: snapshot("s2", "b".repeat(40), "services/billing"),
        scanJob: null,
      },
    ],
  });
  const pins = repositoryPinViews(setup);
  assert.deepEqual(
    pins.map((pin) => [
      pin.repositoryKey,
      pin.fullName,
      pin.commit?.slice(0, 7),
      pin.sourcePathPrefix,
    ]),
    [
      ["web", "acme/web", "aaaaaaa", null],
      ["api", "acme/api", "bbbbbbb", "services/billing"],
    ],
  );
});

test("an assessment saved before sets existed is a list of one that falls back to the case commit", () => {
  const setup = setupOf({ connection: connection("acme/legacy", "c1") });
  const [only, ...rest] = repositoryPinViews(setup, "d".repeat(40));
  assert.equal(rest.length, 0);
  assert.equal(only?.fullName, "acme/legacy");
  assert.equal(only?.commit, "d".repeat(40));
  assert.deepEqual(repositoryPinViews(null), []);
  assert.deepEqual(repositoryPinViews(setupOf()), []);
});

test("the pin list names each repository and only scoped ones show a prefix", () => {
  setAppLocale("en");
  const view = render(
    <RepositoryPinList
      repositories={[
        {
          repositoryKey: "web",
          fullName: "acme/web",
          commit: "a".repeat(40),
          sourcePathPrefix: null,
        },
        {
          repositoryKey: "api",
          fullName: "acme/api",
          commit: "b".repeat(40),
          sourcePathPrefix: "services/billing",
        },
      ]}
    />,
  );
  const text = view.textContent ?? "";
  assert.ok(text.includes("web · acme/web"));
  assert.ok(text.includes("api · acme/api"));
  assert.ok(text.includes("aaaaaaa") && text.includes("bbbbbbb"));
  assert.equal(text.split("services/billing").length - 1, 1);
});

test("a single repository is listed without its key", () => {
  setAppLocale("en");
  const view = render(
    <RepositoryPinList
      repositories={[
        {
          repositoryKey: "web",
          fullName: "acme/web",
          commit: "a".repeat(40),
          sourcePathPrefix: null,
        },
      ]}
    />,
  );
  assert.ok(!(view.textContent ?? "").includes("web · "));
  assert.ok((view.textContent ?? "").includes("acme/web"));
});

test("the opening message lists every repository of a set and keeps the single-repository wording otherwise", () => {
  setAppLocale("en");
  const base = {
    kind: CONVERSATION_TURN_KINDS.OPENING,
    id: "opening",
    sequence: 0,
    at: "2026-11-27T00:00:00.000Z",
    ruleSetVersion: null,
  } as const;
  const multi = render(
    <ConversationOpeningTurn
      turn={{
        ...base,
        repositoryFullName: "acme/web",
        commit: "a".repeat(40),
        repositories: [
          { fullName: "acme/web", commit: "a".repeat(40) },
          { fullName: "acme/api", commit: "b".repeat(40) },
        ],
      }}
    />,
  );
  const multiText = multi.textContent ?? "";
  assert.ok(
    multiText.includes("acme/web (aaaaaaa)") &&
      multiText.includes("acme/api (bbbbbbb)"),
  );
  const single = render(
    <ConversationOpeningTurn
      turn={{
        ...base,
        repositoryFullName: "acme/web",
        commit: "a".repeat(40),
        repositories: [{ fullName: "acme/web", commit: "a".repeat(40) }],
      }}
    />,
  );
  assert.ok((single.textContent ?? "").includes("acme/web at aaaaaaa"));
});

test("a repository badge precedes the evidence path when the evidence is bound to a repository", () => {
  setAppLocale("en");
  const item = (evidenceId: string, repositoryKey: string | null) => ({
    evidenceId,
    type: "REPOSITORY_SOURCE",
    repositoryKey,
    path: "src/consent.ts",
    startLine: 3,
    endLine: 9,
    excerpt: null,
    role: "role",
    supportedCriterionId: null,
    queries: null,
    scopes: null,
  });
  const view = render(
    <EvidenceRelationshipViewer
      hasEvidenceGap={false}
      evidenceList={[item("e1", "billing-api"), item("e2", null)]}
    />,
  );
  const badges = [
    ...view.querySelectorAll("[data-slot='evidence-repository']"),
  ];
  assert.equal(badges.length, 1);
  assert.equal(badges[0]?.textContent, "billing-api");
});

test("the tracking list shows each repository's own freshness and is hidden for a single repository", () => {
  setAppLocale("en");
  const entry = (
    repositoryKey: string,
    name: string,
    freshnessStatus: CustomerTrackingAssessmentItem["repositories"][number]["freshnessStatus"],
    latestCommit: string | null,
  ): CustomerTrackingAssessmentItem["repositories"][number] => ({
    repositoryKey,
    name,
    owner: "acme",
    pinnedCommit: "a".repeat(40),
    latestCommit,
    observedAt: null,
    freshnessStatus,
    isStale: freshnessStatus === TRACKING_FRESHNESS_STATUSES.STALE,
  });
  const view = render(
    <TrackingRepositoryList
      repositories={[
        entry(
          "web",
          "web",
          TRACKING_FRESHNESS_STATUSES.CURRENT,
          "a".repeat(40),
        ),
        entry("api", "api", TRACKING_FRESHNESS_STATUSES.STALE, "c".repeat(40)),
      ]}
    />,
  );
  const text = view.textContent ?? "";
  assert.ok(text.includes("acme/web") && text.includes("acme/api"));
  assert.ok(text.includes("aaaaaaa → ccccccc"));
  assert.equal(view.querySelectorAll("li").length, 2);
  const single = render(
    <TrackingRepositoryList
      repositories={[
        entry("web", "web", TRACKING_FRESHNESS_STATUSES.CURRENT, null),
      ]}
    />,
  );
  assert.equal(
    single.querySelector("[data-slot='tracking-repository-list']"),
    null,
  );
});
