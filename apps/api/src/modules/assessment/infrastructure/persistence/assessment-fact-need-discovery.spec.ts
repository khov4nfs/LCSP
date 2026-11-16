import { describe, expect, it, jest } from "@jest/globals";
import {
  DISCOVERY_EVIDENCE_STRENGTHS,
  DISCOVERY_EXPANSION_STATES,
  DISCOVERY_OBSERVATION_STATUSES,
  DISCOVERY_REACHABILITY_STATES,
  DISCOVERY_SIGNAL_TYPES,
  DISCOVERY_SOURCE_CLASSIFICATIONS,
  DISCOVERY_TECHNOLOGY_RELEVANCE,
  REPOSITORY_DISCOVERY_VERSIONS,
  REPOSITORY_SCANNER_VERSIONS,
  computeRepositoryDiscoveryCacheIdentity,
  computeRepositoryDiscoveryDigest,
  type RepositoryDiscovery,
} from "@lcsp/contracts/assessment-domain";
import type { Prisma } from "@prisma/client";
import { validateFactNeedDiscoveryProvenanceInTx } from "./assessment-fact-need.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const recordId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const repositorySnapshotId = "snapshot-1";
const repositoryCommit = "a".repeat(40);
const rangeId = sha("3");

function discovery(): RepositoryDiscovery {
  const base = {
    repositoryId: "repository-1",
    commitSha: repositoryCommit,
    sourcePathPrefix: "apps/api",
    scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
    discoveryVersion: REPOSITORY_DISCOVERY_VERSIONS.v1,
    scannerSignature: sha("1"),
    graphIndexVersion: sha("2"),
    cacheIdentity: sha("0"),
    sourceRanges: [
      {
        rangeId,
        path: "apps/api/model.ts",
        startLine: 4,
        endLine: 4,
        sourceDigest: sha("4"),
        symbol: "invokeModel",
        signalType: DISCOVERY_SIGNAL_TYPES.aiSdkCall,
        sourceClassification:
          DISCOVERY_SOURCE_CLASSIFICATIONS.productionCandidate,
        reachability: DISCOVERY_REACHABILITY_STATES.notEstablished,
        observationStatus: DISCOVERY_OBSERVATION_STATUSES.observedSourceFact,
        technologyRelevance: [DISCOVERY_TECHNOLOGY_RELEVANCE.aiInvocation],
        useCaseIds: [],
        ruleRelevance: [],
        evidenceStrength: DISCOVERY_EVIDENCE_STRENGTHS.directSource,
        explanation: "Direct model invocation candidate.",
        callers: [],
        callees: [],
        unresolvedEdges: [],
        coverageGaps: [],
        expansionState: DISCOVERY_EXPANSION_STATES.permitted,
      },
    ],
    aiUseCases: [],
    ruleCandidates: [],
    knownGaps: [],
    unsupportedLanguages: [],
    skippedPaths: [],
    unresolvedCalls: [],
    resourceLedger: {
      budget: { maxFiles: 100, maxBytes: 1_000, maxRanges: 100 },
      usage: { filesScanned: 1, bytesInspected: 100, rangesProduced: 1 },
      remaining: { files: 99, bytes: 900, ranges: 99 },
      coverageImpact: {
        knownGapCount: 0,
        unresolvedCallCount: 0,
        unsupportedLanguageCount: 0,
        truncated: false,
      },
      expansionHistory: [],
    },
    scannedFileCount: 1,
    generatedAt: "2026-11-16T10:00:00.000Z",
  } satisfies Omit<RepositoryDiscovery, "contentDigest" | "discoveryId">;
  const cacheIdentity = computeRepositoryDiscoveryCacheIdentity(base);
  const withCache = { ...base, cacheIdentity };
  const contentDigest = computeRepositoryDiscoveryDigest(withCache);
  return { ...withCache, contentDigest, discoveryId: contentDigest };
}

function transaction(payload: RepositoryDiscovery | null) {
  return {
    assessmentRepositoryDiscovery: {
      findMany: jest.fn(() =>
        Promise.resolve(
          payload
            ? [
                {
                  recordId,
                  contentDigest: payload.contentDigest,
                  payload,
                },
              ]
            : [],
        ),
      ),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("FactNeed discovery provenance", () => {
  it("accepts only exact range IDs from an integrity-valid pinned discovery", async () => {
    const payload = discovery();
    const refs = await validateFactNeedDiscoveryProvenanceInTx(
      transaction(payload),
      {
        assessmentId,
        repositorySnapshotId,
        repositoryCommit,
        sourcePathPrefix: "apps/api",
        investigationDiscoveryRefs: [
          { recordId, contentDigest: payload.contentDigest },
        ],
        investigatedRangeIds: [rangeId],
        correlationId: "correlation-1",
      },
    );

    expect(refs).toEqual([{ recordId, contentDigest: payload.contentDigest }]);
  });

  it("fails closed for a missing record or an invented range ID", async () => {
    const payload = discovery();
    const input = {
      assessmentId,
      repositorySnapshotId,
      repositoryCommit,
      sourcePathPrefix: "apps/api",
      investigationDiscoveryRefs: [
        { recordId, contentDigest: payload.contentDigest },
      ],
      investigatedRangeIds: [sha("9")],
      correlationId: "correlation-2",
    };

    await expect(
      validateFactNeedDiscoveryProvenanceInTx(transaction(payload), input),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      validateFactNeedDiscoveryProvenanceInTx(transaction(null), {
        ...input,
        investigatedRangeIds: [rangeId],
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
