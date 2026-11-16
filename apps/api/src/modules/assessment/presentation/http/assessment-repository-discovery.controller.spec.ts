import { randomUUID } from "node:crypto";

import {
  DISCOVERY_DETAIL_COLLECTIONS,
  REPOSITORY_DISCOVERY_VERSIONS,
  REPOSITORY_SCANNER_VERSIONS,
  computeRepositoryDiscoveryCacheIdentity,
  computeRepositoryDiscoveryDigest,
  type RepositoryDiscovery,
  type RepositoryDiscoveryDetailPage,
  type RepositoryDiscoveryRangePage,
  type RepositoryDiscoverySaveResult,
  type RepositoryDiscoverySummary,
} from "@lcsp/contracts/assessment-domain";
import { describe, expect, it, jest } from "@jest/globals";
import type { ExecutionContext } from "@nestjs/common";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { AssessmentRepositoryDiscoveryService } from "../../application/services/assessment-repository-discovery.service.js";
import { AssessmentRepositoryDiscoveryController } from "./assessment-repository-discovery.controller.js";
import { AssessmentLeaseGuard } from "./assessment-lease.guard.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

function artifact(): RepositoryDiscovery {
  const withoutIdentity = {
    repositoryId: "repository-1",
    commitSha: "a".repeat(40),
    sourcePathPrefix: null,
    scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
    discoveryVersion: REPOSITORY_DISCOVERY_VERSIONS.v1,
    scannerSignature: sha("1"),
    graphIndexVersion: sha("2"),
    cacheIdentity: sha("0"),
    sourceRanges: [],
    aiUseCases: [],
    ruleCandidates: [],
    knownGaps: [],
    unsupportedLanguages: [],
    skippedPaths: [],
    unresolvedCalls: [],
    resourceLedger: {
      budget: { maxFiles: 100, maxBytes: 1_000_000, maxRanges: 100 },
      usage: { filesScanned: 0, bytesInspected: 0, rangesProduced: 0 },
      remaining: { files: 100, bytes: 1_000_000, ranges: 100 },
      coverageImpact: {
        knownGapCount: 0,
        unresolvedCallCount: 0,
        unsupportedLanguageCount: 0,
        truncated: false,
      },
      expansionHistory: [],
    },
    scannedFileCount: 0,
    generatedAt: "2026-11-16T10:00:00.000Z",
  } satisfies Omit<RepositoryDiscovery, "discoveryId" | "contentDigest">;
  const cacheIdentity =
    computeRepositoryDiscoveryCacheIdentity(withoutIdentity);
  const contentDigest = computeRepositoryDiscoveryDigest({
    ...withoutIdentity,
    cacheIdentity,
  });
  return {
    ...withoutIdentity,
    cacheIdentity,
    contentDigest,
    discoveryId: contentDigest,
  };
}

describe("AssessmentRepositoryDiscoveryController", () => {
  const save = jest.fn<AssessmentRepositoryDiscoveryService["save"]>(
    (input): Promise<RepositoryDiscoverySaveResult> =>
      Promise.resolve({
        recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        cacheIdentity: input.discovery.cacheIdentity,
        contentDigest: input.discovery.contentDigest,
        replayed: false,
      }),
  );
  const getSummary = jest.fn<
    AssessmentRepositoryDiscoveryService["getSummary"]
  >((): Promise<RepositoryDiscoverySummary> =>
    Promise.resolve({ available: false, discovery: null }),
  );
  const getRangePage = jest.fn<
    AssessmentRepositoryDiscoveryService["getRangePage"]
  >((): Promise<RepositoryDiscoveryRangePage> =>
    Promise.resolve({
      recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      contentDigest: sha("1"),
      total: 0,
      offset: 0,
      limit: 25,
      nextOffset: null,
      ranges: [],
    }),
  );
  const getDetailPage = jest.fn<
    AssessmentRepositoryDiscoveryService["getDetailPage"]
  >((): Promise<RepositoryDiscoveryDetailPage> =>
    Promise.resolve({
      recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      contentDigest: sha("1"),
      collection: DISCOVERY_DETAIL_COLLECTIONS.aiUseCases,
      total: 0,
      offset: 0,
      limit: 25,
      nextOffset: null,
      items: [],
    }),
  );

  const controller = new AssessmentRepositoryDiscoveryController({
    save,
    getSummary,
    getRangePage,
    getDetailPage,
  } as unknown as AssessmentRepositoryDiscoveryService);
  const request = { correlationId: "corr-controller" } as AuthenticatedRequest;

  it("rejects a malformed lease in the shared guard before controller dispatch", () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { "x-assessment-lease": "not-a-lease" },
          correlationId: "corr-lease",
        }),
      }),
    } as unknown as ExecutionContext;

    expect(() => new AssessmentLeaseGuard().canActivate(context)).toThrow();
  });

  it("forwards a strict artifact and lease through the success envelope", async () => {
    const assessmentId = randomUUID();
    const leaseToken = randomUUID();
    const discovery = artifact();
    const response = await controller.save(
      assessmentId,
      leaseToken,
      discovery,
      request,
    );

    expect(response).toMatchObject({
      ok: true,
      data: {
        cacheIdentity: discovery.cacheIdentity,
        contentDigest: discovery.contentDigest,
        replayed: false,
      },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ assessmentId, leaseToken, discovery }),
    );
  });

  it("returns explicit absence through the leased summary read", async () => {
    const response = await controller.summary(
      randomUUID(),
      randomUUID(),
      request,
    );

    expect(response).toEqual({
      ok: true,
      data: { available: false, discovery: null },
    });
  });
});
