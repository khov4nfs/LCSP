import { describe, expect, it } from "@jest/globals";
import {
  assessmentDiscoveryBatchViewSchema,
  assessmentDiscoveryLatestRunSchema,
  assessmentDiscoveryRunClaimSchema,
  assessmentDiscoveryRunViewSchema,
  repositoryDiscoverySummaryQuerySchema,
} from "../src/assessment-domain/index.ts";

const batchId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function view(overrides: Record<string, unknown> = {}) {
  return {
    runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    assessmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "QUEUED",
    attempt: 1,
    repositoryKey: "web",
    discoveryBatchId: batchId,
    repositorySnapshotId: "snapshot-web",
    repositoryCommit: "a".repeat(40),
    sourcePathPrefix: null,
    requestedAt: "2026-11-26T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    discovery: { available: false, discovery: null },
    ...overrides,
  };
}

describe("discovery batch contracts", () => {
  it("reads a run written before repository sets as a run with no repository or batch", () => {
    const { repositoryKey, discoveryBatchId, ...legacy } = view();
    void repositoryKey;
    void discoveryBatchId;
    const parsed = assessmentDiscoveryRunViewSchema.parse(legacy);
    expect(parsed.repositoryKey).toBeNull();
    expect(parsed.discoveryBatchId).toBeNull();
  });

  it("accepts one run per pinned repository in a batch and rejects a malformed repository key", () => {
    const second = view({
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      repositoryKey: "billing-api",
      repositorySnapshotId: "snapshot-api",
      repositoryCommit: "b".repeat(40),
      sourcePathPrefix: "services/billing",
    });
    const parsed = assessmentDiscoveryBatchViewSchema.parse({
      batchId,
      run: view(),
      runs: [view(), second],
    });
    expect(parsed.runs.map((run) => run.repositoryKey)).toEqual([
      "web",
      "billing-api",
    ]);
    expect(
      assessmentDiscoveryRunViewSchema.safeParse(
        view({ repositoryKey: "Not A Key" }),
      ).success,
    ).toBe(false);
  });

  it("limits a batch to the maximum number of repositories and refuses an empty one", () => {
    const many = Array.from({ length: 6 }, () => view());
    expect(
      assessmentDiscoveryBatchViewSchema.safeParse({
        batchId,
        run: view(),
        runs: many,
      }).success,
    ).toBe(false);
    expect(
      assessmentDiscoveryBatchViewSchema.safeParse({
        batchId,
        run: view(),
        runs: [],
      }).success,
    ).toBe(false);
  });

  it("restores an absent discovery as an empty batch and a present one with every run", () => {
    expect(
      assessmentDiscoveryLatestRunSchema.parse({ available: false, run: null }),
    ).toEqual({ available: false, run: null, runs: [] });
    expect(
      assessmentDiscoveryLatestRunSchema.safeParse({
        available: true,
        run: view(),
        runs: [],
      }).success,
    ).toBe(false);
    expect(
      assessmentDiscoveryLatestRunSchema.parse({
        available: true,
        run: view(),
        runs: [view()],
      }).available,
    ).toBe(true);
  });

  it("names the repository on a worker claim and defaults it for older claims", () => {
    const claim = {
      runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      assessmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      leaseToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      threadId: "discovery:a:b",
      repositorySnapshotId: "snapshot-web",
      repositoryId: "repository-1",
      repositoryCommit: "a".repeat(40),
      sourcePathPrefix: null,
      repositoryScanJobId: "job-1",
      attempt: 1,
      alreadyCompleted: false,
    };
    expect(
      assessmentDiscoveryRunClaimSchema.parse(claim).repositoryKey,
    ).toBeNull();
    expect(
      assessmentDiscoveryRunClaimSchema.parse({
        ...claim,
        repositoryKey: "web",
      }).repositoryKey,
    ).toBe("web");
  });

  it("lets a summary request name only a well-formed repository key", () => {
    expect(repositoryDiscoverySummaryQuerySchema.parse({})).toEqual({});
    expect(
      repositoryDiscoverySummaryQuerySchema.parse({ repositoryKey: "api" }),
    ).toEqual({ repositoryKey: "api" });
    expect(
      repositoryDiscoverySummaryQuerySchema.safeParse({
        repositoryKey: "../etc",
      }).success,
    ).toBe(false);
    expect(
      repositoryDiscoverySummaryQuerySchema.safeParse({ other: "x" }).success,
    ).toBe(false);
  });
});
