import { randomUUID } from "node:crypto";

import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  DISCOVERY_INTERVIEW_PROPOSAL_STATUSES,
  DISCOVERY_INTERVIEW_REVIEW_ACTIONS,
  DISCOVERY_OBSERVATION_STATUSES,
  DISCOVERY_EVIDENCE_STRENGTHS,
  DISCOVERY_EXPANSION_STATES,
  DISCOVERY_REACHABILITY_STATES,
  DISCOVERY_SIGNAL_TYPES,
  DISCOVERY_SOURCE_CLASSIFICATIONS,
  DISCOVERY_TECHNOLOGY_RELEVANCE,
  REPOSITORY_SCANNER_VERSIONS,
  REPOSITORY_DISCOVERY_VERSIONS,
  computeRepositoryDiscoveryCacheIdentity,
  computeRepositoryDiscoveryDigest,
  type SubmitRepositoryDiscovery,
} from "@lcsp/contracts/assessment-domain";
import {
  AssessmentDiscoveryInterviewProposalStatus,
  AssessmentDiscoveryRunStatus,
  AssessmentFactNeedStatus,
} from "@prisma/client";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentCaseSupport } from "../../infrastructure/persistence/assessment-case-support.service.js";
import type { AssessmentRepositoryDiscoveryService } from "./assessment-repository-discovery.service.js";
import type { AssessmentEvidenceInvalidation } from "./assessment-evidence-invalidation.service.js";
import { sha256Hex } from "../../domain/domain-ids.js";
import { AssessmentDiscoveryInterviewService } from "./assessment-discovery-interview.service.js";

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const discoveryRecordId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const useCaseId = `sha256:${"e".repeat(64)}`;
const question = "Is the chatbot deployed to production in Vietnam?";
const commit = "a".repeat(40);
const sha = (hex: string) => `sha256:${hex.repeat(64)}`;

function discovery(
  overrides: Partial<SubmitRepositoryDiscovery> = {},
): SubmitRepositoryDiscovery {
  const base = {
    repositoryId: "repository-1",
    commitSha: commit,
    sourcePathPrefix: null,
    scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
    discoveryVersion: REPOSITORY_DISCOVERY_VERSIONS.v1,
    scannerSignature: sha("1"),
    graphIndexVersion: sha("2"),
    cacheIdentity: sha("0"),
    sourceRanges: [
      {
        rangeId: sha("7"),
        path: "app/chatbot.ts",
        startLine: 12,
        endLine: 15,
        sourceDigest: sha("8"),
        symbol: "invokeModel",
        signalType: DISCOVERY_SIGNAL_TYPES.aiSdkCall,
        sourceClassification:
          DISCOVERY_SOURCE_CLASSIFICATIONS.productionCandidate,
        reachability: DISCOVERY_REACHABILITY_STATES.notEstablished,
        observationStatus: DISCOVERY_OBSERVATION_STATUSES.observedSourceFact,
        technologyRelevance: [DISCOVERY_TECHNOLOGY_RELEVANCE.aiInvocation],
        useCaseIds: [useCaseId],
        ruleRelevance: [],
        evidenceStrength: DISCOVERY_EVIDENCE_STRENGTHS.directSource,
        explanation: "Model call; operational deployment is unknown.",
        callers: [],
        callees: [],
        unresolvedEdges: [],
        coverageGaps: [],
        expansionState: DISCOVERY_EXPANSION_STATES.permitted,
      },
    ],
    aiUseCases: [
      {
        useCaseId,
        name: "Customer support chatbot",
        observationStatus: DISCOVERY_OBSERVATION_STATUSES.candidateFinding,
        providerOrFramework: "OpenAI",
        invocationRangeIds: [sha("7")],
        inputRangeIds: [],
        outputRangeIds: [],
        controlRangeIds: [],
        unresolvedQuestions: [question],
      },
    ],
    ruleCandidates: [],
    knownGaps: [],
    unsupportedLanguages: [],
    skippedPaths: [],
    unresolvedCalls: [],
    resourceLedger: {
      budget: { maxFiles: 100, maxBytes: 1_000_000, maxRanges: 100 },
      usage: { filesScanned: 1, bytesInspected: 100, rangesProduced: 1 },
      remaining: { files: 99, bytes: 999_900, ranges: 99 },
      coverageImpact: {
        knownGapCount: 0,
        unresolvedCallCount: 0,
        unsupportedLanguageCount: 0,
        truncated: false,
      },
      expansionHistory: [],
    },
    scannedFileCount: 1,
    generatedAt: "2026-11-17T00:00:00.000Z",
  } satisfies Omit<SubmitRepositoryDiscovery, "discoveryId" | "contentDigest">;
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

type Proposal = {
  proposalId: string;
  assessmentId: string;
  discoveryRunId: string;
  factNeedId: string;
  idempotencyKey: string;
  requestDigest: string;
  useCaseId: string;
  question: string;
  answer: string;
  status: AssessmentDiscoveryInterviewProposalStatus;
  guardFailure: string | null;
  submittedBy: string;
  reviewedBy: string | null;
  acceptedFactId: string | null;
  acceptedEvidenceId: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
};

function fixture() {
  let owner = ownerId;
  let caseRevision = 0;
  let currentAuditRequestId: string | null = null;
  const needs = new Map<string, Record<string, unknown>>();
  const proposals = new Map<string, Proposal>();
  const evidence: Array<Record<string, unknown>> = [];
  const facts: Array<Record<string, unknown>> = [];
  let sourceQuestionValid = true;
  let artifact = discovery();
  const run = {
    runId,
    assessmentId,
    discoveryRecordId,
    status: AssessmentDiscoveryRunStatus.COMPLETED,
    repositorySnapshotId: "snapshot-1",
    repositoryId: "repository-1",
    repositoryCommit: commit,
    sourcePathPrefix: null,
  };
  const pins = {
    assessmentId,
    caseRevision: 0,
    ruleSetVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    repositorySnapshotId: "snapshot-1",
    repositoryId: "repository-1",
    repositoryScanJobId: "scan-job-1",
    repositoryCommit: commit,
    sourcePathPrefix: null,
    repositorySetDigest: `sha256:${"1".repeat(64)}`,
    repositorySetRecorded: true,
    repositories: [
      {
        repositoryKey: "web",
        ordinal: 0,
        connectionId: "connection-1",
        repositoryId: "repository-1",
        repositoryFullName: "acme/web",
        repositorySnapshotId: "snapshot-1",
        repositoryScanJobId: "scan-job-1",
        repositoryCommit: commit,
        sourcePathPrefix: null as string | null,
      },
    ],
  };
  const tx = {
    assessment: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          ownerId: owner,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          domainCase: { auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED },
        }),
      ),
    },
    assessmentRuntime: {
      findUnique: jest.fn(() => Promise.resolve({ currentAuditRequestId })),
    },
    assessmentDiscoveryRun: {
      findUnique: jest.fn(() => Promise.resolve(run)),
      update: jest.fn(({ data }: { data: { discoveryRecordId: string } }) => {
        run.discoveryRecordId = data.discoveryRecordId;
        return Promise.resolve(run);
      }),
    },
    assessmentCase: {
      update: jest.fn(({ data }: { data: { caseRevision: number } }) => {
        caseRevision = data.caseRevision;
        return Promise.resolve({ caseRevision });
      }),
      findUnique: jest.fn(() => Promise.resolve({ caseRevision })),
    },
    assessmentRepositoryDiscovery: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            recordId: discoveryRecordId,
            contentDigest: artifact.contentDigest,
            payload: artifact,
            repositorySnapshotId: run.repositorySnapshotId,
          },
        ]),
      ),
    },
    assessmentFactNeed: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            factNeedId?: string;
            assessmentId_identityDigest?: {
              assessmentId: string;
              identityDigest: string;
            };
          };
        }) => {
          if (where.factNeedId)
            return Promise.resolve(needs.get(where.factNeedId) ?? null);
          return Promise.resolve(
            [...needs.values()].find(
              (need) =>
                need.identityDigest ===
                where.assessmentId_identityDigest?.identityDigest,
            ) ?? null,
          );
        },
      ),
      findUniqueOrThrow: jest.fn(
        ({ where }: { where: { factNeedId: string } }) => {
          const row = needs.get(where.factNeedId);
          if (!row) return Promise.reject(new Error("fixture missing need"));
          return Promise.resolve(row);
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, status: AssessmentFactNeedStatus.OPEN };
        needs.set(String(data.factNeedId), row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { factNeedId: string };
          data: Record<string, unknown>;
        }) => {
          const row = needs.get(where.factNeedId)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { factNeedId: string; status: AssessmentFactNeedStatus };
          data: Record<string, unknown>;
        }) => {
          const row = needs.get(where.factNeedId);
          if (!row || row.status !== where.status)
            return Promise.resolve({ count: 0 });
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    assessmentDiscoveryInterviewProposal: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            proposalId?: string;
            assessmentId_idempotencyKey?: {
              assessmentId: string;
              idempotencyKey: string;
            };
          };
        }) => {
          if (where.proposalId)
            return Promise.resolve(proposals.get(where.proposalId) ?? null);
          return Promise.resolve(
            [...proposals.values()].find(
              (row) =>
                row.idempotencyKey ===
                where.assessmentId_idempotencyKey?.idempotencyKey,
            ) ?? null,
          );
        },
      ),
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: {
            factNeedId: string;
            status: AssessmentDiscoveryInterviewProposalStatus;
          };
        }) =>
          Promise.resolve(
            [...proposals.values()].find(
              (row) =>
                row.factNeedId === where.factNeedId &&
                row.status === where.status,
            ) ?? null,
          ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row: Proposal = {
          ...data,
          proposalId: String(data.proposalId),
          assessmentId: String(data.assessmentId),
          discoveryRunId: String(data.discoveryRunId),
          factNeedId: String(data.factNeedId),
          idempotencyKey: String(data.idempotencyKey),
          requestDigest: String(data.requestDigest),
          useCaseId: String(data.useCaseId),
          question: String(data.question),
          answer: String(data.answer),
          submittedBy: String(data.submittedBy),
          status: AssessmentDiscoveryInterviewProposalStatus.PENDING_REVIEW,
          guardFailure:
            typeof data.guardFailure === "string" ? data.guardFailure : null,
          reviewedBy: null,
          acceptedFactId: null,
          acceptedEvidenceId: null,
          createdAt: new Date("2026-11-17T00:00:00.000Z"),
          reviewedAt: null,
        };
        proposals.set(row.proposalId, row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { proposalId: string };
          data: Record<string, unknown>;
        }) => {
          const row = proposals.get(where.proposalId)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
      count: jest.fn(() => Promise.resolve(proposals.size)),
      findMany: jest.fn(({ skip, take }: { skip: number; take: number }) =>
        Promise.resolve([...proposals.values()].slice(skip, skip + take)),
      ),
    },
    assessmentEvidence: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        evidence.push(data);
        return Promise.resolve(data);
      }),
    },
    assessmentCaseFact: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        facts.push(data);
        return Promise.resolve(data);
      }),
    },
    assessmentCaseFactEvidence: {
      create: jest.fn(() => Promise.resolve({ linked: true })),
    },
  };
  const prisma = {
    $transaction: jest.fn((cb: (client: unknown) => Promise<unknown>) =>
      cb(tx),
    ),
    assessmentCase: tx.assessmentCase,
  };
  const support = {
    lockCase: jest.fn(() => Promise.resolve(undefined)),
    loadPins: jest.fn(() => Promise.resolve({ ...pins, caseRevision })),
  };
  const discoveries = {
    verifyInterviewQuestionInTx: jest.fn((tx: unknown, input: unknown) => {
      void tx;
      void input;
      if (!sourceQuestionValid)
        return Promise.reject(new Error("UNVERIFIED_SOURCE_QUESTION"));
      return Promise.resolve({
        contentDigest: artifact.contentDigest,
        rangeIds: [sha("7")],
      });
    }),
    refreshCandidateRecommendationsInTx: jest.fn(() =>
      Promise.resolve({
        recordId: "99999999-9999-4999-8999-999999999999",
        cacheIdentity: artifact.cacheIdentity,
        contentDigest: artifact.contentDigest,
        replayed: false,
      }),
    ),
  };
  const invalidation = {
    invalidateFinalReportInTx: jest.fn(() => Promise.resolve(undefined)),
  };
  const service = new AssessmentDiscoveryInterviewService(
    prisma as unknown as PrismaService,
    support as unknown as AssessmentCaseSupport,
    discoveries as unknown as AssessmentRepositoryDiscoveryService,
    invalidation as unknown as AssessmentEvidenceInvalidation,
  );
  return {
    service,
    proposals,
    facts,
    evidence,
    needs,
    tx,
    support,
    discoveries,
    /** Pin a second repository and make the discovery run belong to it. */
    useSecondRepository: () => {
      const second = {
        repositoryKey: "api",
        ordinal: 1,
        connectionId: "connection-2",
        repositoryId: "repository-2",
        repositoryFullName: "acme/api",
        repositorySnapshotId: "snapshot-2",
        repositoryScanJobId: "scan-job-2",
        repositoryCommit: "b".repeat(40),
        sourcePathPrefix: "services/billing" as string | null,
      };
      pins.repositories.push(second);
      artifact = discovery({
        repositoryId: second.repositoryId,
        commitSha: second.repositoryCommit,
        sourcePathPrefix: second.sourcePathPrefix,
      });
      Object.assign(run, {
        repositorySnapshotId: second.repositorySnapshotId,
        repositoryId: second.repositoryId,
        repositoryCommit: second.repositoryCommit,
        sourcePathPrefix: second.sourcePathPrefix,
      });
    },
    dropSecondRepository: () => {
      pins.repositories.pop();
    },
    setOwner: (value: string) => {
      owner = value;
    },
    setAuditRequest: (value: string | null) => {
      currentAuditRequestId = value;
    },
    setSourceQuestionValid: (value: boolean) => {
      sourceQuestionValid = value;
    },
  };
}

function submit(
  key = randomUUID(),
  answer = "Yes, our chatbot runs in production in Vietnam.",
) {
  return {
    assessmentId,
    runId,
    ownerId,
    correlationId: "corr-discovery-interview",
    answer: { idempotencyKey: key, useCaseId, question, answer },
  };
}

describe("Pre-scope Discovery Context Interview", () => {
  it("stores a source-backed proposal without creating accepted evidence or facts", async () => {
    const f = fixture();
    const proposal = await f.service.submit(submit());
    expect(proposal.status).toBe(
      DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.pendingReview,
    );
    expect(proposal.acceptedFactId).toBeNull();
    expect(f.needs.size).toBe(1);
    expect(f.proposals.size).toBe(1);
    expect(f.facts).toHaveLength(0);
    expect(f.evidence).toHaveLength(0);
    expect(f.discoveries.verifyInterviewQuestionInTx).toHaveBeenCalledTimes(1);
  });

  it("replays an exact idempotency key without creating a second proposal", async () => {
    const f = fixture();
    const input = submit(randomUUID());
    const a = await f.service.submit(input);
    const b = await f.service.submit(input);
    expect(b.proposalId).toBe(a.proposalId);
    expect(f.proposals.size).toBe(1);
    await expect(
      f.service.submit({
        ...input,
        answer: { ...input.answer, answer: "A different operational fact" },
      }),
    ).rejects.toThrow();
  });

  it("rejects foreign owners and unverified Discovery questions", async () => {
    const f = fixture();
    f.setOwner(randomUUID());
    await expect(f.service.submit(submit())).rejects.toThrow();
    expect(f.proposals.size).toBe(0);
    f.setOwner(ownerId);
    f.setSourceQuestionValid(false);
    await expect(f.service.submit(submit())).rejects.toThrow();
    expect(f.proposals.size).toBe(0);
  });

  it("cannot open an interview after an audit scope was selected", async () => {
    const f = fixture();
    f.setAuditRequest(randomUUID());
    await expect(f.service.submit(submit())).rejects.toThrow();
    expect(f.needs.size).toBe(0);
  });

  it("keeps ambiguous answers pending and denies acceptance", async () => {
    const f = fixture();
    const proposal = await f.service.submit(
      submit(
        randomUUID(),
        "It may have been deployed, but we have not confirmed it yet.",
      ),
    );
    expect(proposal.guardFailure).not.toBeNull();
    await expect(
      f.service.review({
        assessmentId,
        runId,
        proposalId: proposal.proposalId,
        ownerId,
        correlationId: "corr-accept-unknown",
        review: {
          action: DISCOVERY_INTERVIEW_REVIEW_ACTIONS.accept,
          expectedCaseRevision: 0,
        },
      }),
    ).rejects.toThrow();
    expect(f.facts).toHaveLength(0);
    expect(f.evidence).toHaveLength(0);
    expect(f.proposals.get(proposal.proposalId)?.status).toBe(
      AssessmentDiscoveryInterviewProposalStatus.PENDING_REVIEW,
    );
  });

  it("rejects a proposal, permits correction, then confirms and refreshes recommendations", async () => {
    const f = fixture();
    const first = await f.service.submit(
      submit(randomUUID(), "We are not sure."),
    );
    const rejected = await f.service.review({
      assessmentId,
      runId,
      proposalId: first.proposalId,
      ownerId,
      correlationId: "corr-reject",
      review: {
        action: DISCOVERY_INTERVIEW_REVIEW_ACTIONS.reject,
        expectedCaseRevision: 0,
      },
    });
    expect(rejected.status).toBe(
      DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.rejected,
    );
    const corrected = await f.service.submit(submit(randomUUID()));
    const accepted = await f.service.review({
      assessmentId,
      runId,
      proposalId: corrected.proposalId,
      ownerId,
      correlationId: "corr-confirm",
      review: {
        action: DISCOVERY_INTERVIEW_REVIEW_ACTIONS.accept,
        expectedCaseRevision: 0,
      },
    });
    expect(accepted.status).toBe(
      DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.accepted,
    );
    expect(accepted.caseRevision).toBe(1);
    expect(accepted.acceptedFactId).toBeTruthy();
    expect(f.facts).toHaveLength(1);
    expect(f.evidence).toHaveLength(1);
    expect(
      f.discoveries.refreshCandidateRecommendationsInTx,
    ).toHaveBeenCalledTimes(1);
    expect(f.tx.assessmentDiscoveryRun.update).toHaveBeenCalledTimes(1);
    expect(f.tx.assessmentFactNeed.updateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects stale review revisions without accepting a fact", async () => {
    const f = fixture();
    const proposal = await f.service.submit(submit());
    await expect(
      f.service.review({
        assessmentId,
        runId,
        proposalId: proposal.proposalId,
        ownerId,
        correlationId: "corr-stale",
        review: {
          action: DISCOVERY_INTERVIEW_REVIEW_ACTIONS.accept,
          expectedCaseRevision: 42,
        },
      }),
    ).rejects.toThrow();
    expect(f.facts).toHaveLength(0);
  });

  it("paginates the owner review ledger with a case revision", async () => {
    const f = fixture();
    await f.service.submit(submit());
    const page = await f.service.list({
      assessmentId,
      runId,
      ownerId,
      correlationId: "corr-list",
      offset: 0,
      limit: 50,
    });
    expect(page.total).toBe(1);
    expect(page.caseRevision).toBe(0);
    expect(page.items).toHaveLength(1);
  });
});

describe("Pre-scope Discovery Context Interview with a repository set", () => {
  it("verifies the question against the repository the run scanned, not the primary one", async () => {
    const f = fixture();
    f.useSecondRepository();
    await f.service.submit(submit());
    expect(f.discoveries.verifyInterviewQuestionInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pins: expect.objectContaining({
          repositoryKey: "api",
          repositorySnapshotId: "snapshot-2",
          repositoryId: "repository-2",
          repositoryCommit: "b".repeat(40),
          sourcePathPrefix: "services/billing",
        }),
      }),
    );
    // The customer question is scoped to that repository, so the same question about another repository stays a distinct need.
    expect(JSON.stringify([...f.needs.values()])).toContain(
      sha256Hex("repository-2").slice(0, 32),
    );
  });

  it("refuses a run of a repository that is no longer pinned", async () => {
    const f = fixture();
    f.useSecondRepository();
    f.dropSecondRepository();
    await expect(f.service.submit(submit())).rejects.toThrow();
    expect(f.discoveries.verifyInterviewQuestionInTx).not.toHaveBeenCalled();
  });
});
