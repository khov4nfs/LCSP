import { randomUUID } from "node:crypto";

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

import { AssessmentRepositoryDiscoveryService } from "./assessment-repository-discovery.service.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const repositorySnapshotId = "snapshot-1";
const repositoryId = "repository-1";
const repositoryCommit = "a".repeat(40);

const pins = {
  assessmentId,
  caseRevision: 0,
  ruleSetVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  repositorySnapshotId,
  repositoryId,
  repositoryScanJobId: "scan-job-1",
  repositoryCommit,
  sourcePathPrefix: "apps/api",
};

function discovery(
  overrides: Partial<RepositoryDiscovery> = {},
): RepositoryDiscovery {
  const base = {
    repositoryId,
    commitSha: repositoryCommit,
    sourcePathPrefix: "apps/api",
    scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
    discoveryVersion: REPOSITORY_DISCOVERY_VERSIONS.v1,
    scannerSignature: sha("1"),
    graphIndexVersion: sha("2"),
    cacheIdentity: sha("0"),
    sourceRanges: [
      {
        rangeId: sha("3"),
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
        useCaseIds: [sha("5")],
        ruleRelevance: [],
        evidenceStrength: DISCOVERY_EVIDENCE_STRENGTHS.directSource,
        explanation:
          "Direct model call; production reachability remains unknown.",
        callers: [],
        callees: [],
        unresolvedEdges: ["Caller unresolved."],
        coverageGaps: [],
        expansionState: DISCOVERY_EXPANSION_STATES.permitted,
      },
    ],
    aiUseCases: [
      {
        useCaseId: sha("5"),
        name: "Candidate model use",
        observationStatus: DISCOVERY_OBSERVATION_STATUSES.candidateFinding,
        providerOrFramework: "OpenAI",
        invocationRangeIds: [sha("3")],
        inputRangeIds: [],
        outputRangeIds: [],
        controlRangeIds: [],
        unresolvedQuestions: ["Is this deployed?"],
      },
    ],
    ruleCandidates: [],
    knownGaps: [],
    unsupportedLanguages: ["Go"],
    skippedPaths: [],
    unresolvedCalls: ["Runtime caller unresolved."],
    resourceLedger: {
      budget: { maxFiles: 100, maxBytes: 1_000_000, maxRanges: 100 },
      usage: { filesScanned: 1, bytesInspected: 100, rangesProduced: 1 },
      remaining: { files: 99, bytes: 999_900, ranges: 99 },
      coverageImpact: {
        knownGapCount: 0,
        unresolvedCallCount: 1,
        unsupportedLanguageCount: 1,
        truncated: false,
      },
      expansionHistory: [],
    },
    scannedFileCount: 1,
    generatedAt: "2026-11-16T10:00:00.000Z",
  } satisfies Omit<RepositoryDiscovery, "discoveryId" | "contentDigest">;
  const merged = { ...base, ...overrides };
  const cacheIdentity = computeRepositoryDiscoveryCacheIdentity(merged);
  const contentDigest = computeRepositoryDiscoveryDigest({
    ...merged,
    cacheIdentity,
  });
  return {
    ...merged,
    cacheIdentity,
    contentDigest,
    discoveryId: contentDigest,
  };
}

type StoredDiscoveryRow = {
  recordId: string;
  assessmentId: string;
  repositorySnapshotId: string;
  repositoryId: string;
  repositoryCommit: string;
  sourcePathPrefix: string | null;
  scannerVersion: string;
  discoveryVersion: string;
  scannerSignature: string;
  graphIndexVersion: string;
  cacheIdentity: string;
  contentDigest: string;
  payload: RepositoryDiscovery;
  createdAt: Date;
};

type StoredDiscoveryInput = Omit<StoredDiscoveryRow, "createdAt">;

function fixture() {
  const rows = new Map<string, StoredDiscoveryRow>();
  let latest: StoredDiscoveryRow | null = null;
  const tx = {
    assessmentRepositoryDiscovery: {
      createMany: jest.fn(({ data }: { data: StoredDiscoveryInput[] }) => {
        const row = data[0];
        if (!row) return Promise.resolve({ count: 0 });
        const key = `${row.assessmentId}|${row.cacheIdentity}|${row.contentDigest}`;
        if (rows.has(key)) return Promise.resolve({ count: 0 });
        const stored = { ...row, createdAt: new Date(), payload: row.payload };
        rows.set(key, stored);
        latest = stored;
        return Promise.resolve({ count: 1 });
      }),
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            assessmentId_cacheIdentity_contentDigest: {
              assessmentId: string;
              cacheIdentity: string;
              contentDigest: string;
            };
          };
        }) => {
          const key = where.assessmentId_cacheIdentity_contentDigest;
          return Promise.resolve(
            rows.get(
              `${key.assessmentId}|${key.cacheIdentity}|${key.contentDigest}`,
            ),
          );
        },
      ),
      findFirst: jest.fn(({ where }: { where: { recordId?: string } }) => {
        if (where.recordId && latest?.recordId !== where.recordId) {
          return Promise.resolve(null);
        }
        return Promise.resolve(latest);
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const authority = {
    authorizeInTx: jest.fn(() =>
      Promise.resolve({ executionId: randomUUID() }),
    ),
  };
  const support = { loadPins: jest.fn(() => Promise.resolve(pins)) };
  const service = new AssessmentRepositoryDiscoveryService(
    prisma as never,
    authority as never,
    support as never,
  );
  return {
    service,
    tx,
    authority,
    support,
    rows,
    setLatest: (row: StoredDiscoveryRow) => {
      latest = row;
    },
  };
}

describe("AssessmentRepositoryDiscoveryService", () => {
  it("persists once and replays identical assessment/cache/content coordinates", async () => {
    const { service, tx, rows } = fixture();
    const artifact = discovery();

    const first = await service.save({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-1",
      discovery: artifact,
    });
    const replay = await service.save({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-2",
      discovery: artifact,
    });

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(rows.size).toBe(1);
    expect(tx.assessmentRepositoryDiscovery.createMany).toHaveBeenCalledTimes(
      2,
    );
  });

  it("retains a different content digest under the same cache identity as a new immutable revision", async () => {
    const { service, rows } = fixture();
    const first = discovery();
    const second = discovery({
      unresolvedCalls: [
        "Runtime caller unresolved.",
        "Dynamic configuration unresolved.",
      ],
    });
    expect(second.cacheIdentity).toBe(first.cacheIdentity);
    expect(second.contentDigest).not.toBe(first.contentDigest);

    const firstReceipt = await service.save({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-1",
      discovery: first,
    });
    const secondReceipt = await service.save({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-2",
      discovery: second,
    });

    expect(firstReceipt.recordId).not.toBe(secondReceipt.recordId);
    expect(secondReceipt.replayed).toBe(false);
    expect(rows.size).toBe(2);
    const latest = await service.getSummary({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-latest",
    });
    expect(latest.discovery?.recordId).toBe(secondReceipt.recordId);
    expect(latest.discovery?.contentDigest).toBe(second.contentDigest);
  });

  it("rejects tampered content and server-owned repository pin mismatches", async () => {
    const { service, tx } = fixture();
    const valid = discovery();
    const tampered = { ...valid, contentDigest: sha("f") };

    await expect(
      service.save({
        assessmentId,
        leaseToken: randomUUID(),
        correlationId: "corr-tamper",
        discovery: tampered,
      }),
    ).rejects.toThrow();
    expect(tx.assessmentRepositoryDiscovery.createMany).not.toHaveBeenCalled();

    await expect(
      service.save({
        assessmentId,
        leaseToken: randomUUID(),
        correlationId: "corr-pin",
        discovery: discovery({ repositoryId: "foreign-repository" }),
      }),
    ).rejects.toThrow();
    expect(tx.assessmentRepositoryDiscovery.createMany).not.toHaveBeenCalled();
  });

  it("returns explicit absence for legacy audits and bounded digest-bound pages when present", async () => {
    const { service } = fixture();
    const absent = await service.getSummary({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-absent",
    });
    expect(absent).toEqual({ available: false, discovery: null });

    const receipt = await service.save({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-save",
      discovery: discovery(),
    });
    const summary = await service.getSummary({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-summary",
    });
    expect(summary.available).toBe(true);
    expect(summary.discovery?.recordId).toBe(receipt.recordId);
    expect(summary.discovery?.sourceRangeCount).toBe(1);
    expect(summary.discovery?.preview.ranges).toHaveLength(1);
    expect(summary.discovery?.preview.aiUseCases).toHaveLength(1);
    expect(summary.discovery?.preview.unresolvedCalls).toEqual([
      "Runtime caller unresolved.",
    ]);

    const ranges = await service.getRangePage({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-ranges",
      recordId: receipt.recordId,
      offset: 0,
      limit: 1,
    });
    expect(ranges.ranges).toHaveLength(1);
    expect(ranges.contentDigest).toBe(summary.discovery?.contentDigest);

    const useCases = await service.getDetailPage({
      assessmentId,
      leaseToken: randomUUID(),
      correlationId: "corr-details",
      recordId: receipt.recordId,
      collection: "AI_USE_CASES",
      offset: 0,
      limit: 1,
    });
    expect(useCases.items).toHaveLength(1);
    expect(useCases.contentDigest).toBe(summary.discovery?.contentDigest);
  });

  it("fails closed when persisted payload no longer matches its immutable metadata", async () => {
    const { service, setLatest } = fixture();
    const artifact = discovery();
    setLatest({
      recordId: randomUUID(),
      assessmentId,
      repositorySnapshotId,
      repositoryId,
      repositoryCommit,
      sourcePathPrefix: pins.sourcePathPrefix,
      scannerVersion: artifact.scannerVersion,
      discoveryVersion: artifact.discoveryVersion,
      scannerSignature: artifact.scannerSignature,
      graphIndexVersion: artifact.graphIndexVersion,
      cacheIdentity: artifact.cacheIdentity,
      contentDigest: artifact.contentDigest,
      payload: { ...artifact, unresolvedCalls: ["tampered after digest"] },
      createdAt: new Date(),
    });

    await expect(
      service.getSummary({
        assessmentId,
        leaseToken: randomUUID(),
        correlationId: "corr-persisted-tamper",
      }),
    ).rejects.toThrow();
  });
});
