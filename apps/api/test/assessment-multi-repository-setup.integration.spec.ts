import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DISCOVERY_COMMAND_TYPES,
  DISCOVERY_DETAIL_COLLECTIONS,
  DISCOVERY_EVIDENCE_STRENGTHS,
  DISCOVERY_EXPANSION_STATES,
  DISCOVERY_OBSERVATION_STATUSES,
  DISCOVERY_REACHABILITY_STATES,
  DISCOVERY_SIGNAL_TYPES,
  DISCOVERY_SOURCE_CLASSIFICATIONS,
  DISCOVERY_TECHNOLOGY_RELEVANCE,
  REPOSITORY_DISCOVERY_VERSIONS,
  REPOSITORY_SCANNER_VERSIONS,
  REPOSITORY_SET_ERROR_CODES,
  computeRepositoryDiscoveryCacheIdentity,
  computeRepositoryDiscoveryDigest,
  computeRepositorySetDigest,
  type SubmitRepositoryDiscovery,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentDiscoveryRunService } from "../src/modules/assessment/application/services/assessment-discovery-run.service.js";
import { AssessmentRepositoryDiscoveryService } from "../src/modules/assessment/application/services/assessment-repository-discovery.service.js";
import { AssessmentLifecycleCoordinator } from "../src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { AssessmentRuntimePreparation } from "../src/modules/assessment/application/services/assessment-runtime-preparation.service.js";
import { CompleteRepositorySetupCommand } from "../src/modules/assessment/application/commands/complete-repository-setup/complete-repository-setup.command.js";
import { CompleteRepositorySetupHandler } from "../src/modules/assessment/application/commands/complete-repository-setup/complete-repository-setup.handler.js";
import { RemoveAssessmentRepositoryCommand } from "../src/modules/assessment/application/commands/remove-assessment-repository/remove-assessment-repository.command.js";
import { RemoveAssessmentRepositoryHandler } from "../src/modules/assessment/application/commands/remove-assessment-repository/remove-assessment-repository.handler.js";
import { AssessmentRepositorySetupLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-repository-setup.loader.js";
import { AssessmentCaseSupport } from "../src/modules/assessment/infrastructure/persistence/assessment-case-support.service.js";
import type { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";

const dbUrl =
  process.env.DATABASE_URL ??
  process.env.PHASE25_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public";

jest.setTimeout(60_000);

describe("multi-repository assessment setup on real PostgreSQL", () => {
  let prisma: PrismaClient;
  const suffix = randomUUID();
  const userId = `user-multirepo-${suffix}`;
  let ruleSetVersionId: string;
  let legalSourceId: string | null = null;
  let prepRunId: string | null = null;
  let createdRuleSet = false;
  let createdRuleId: string | null = null;

  const commitWeb = "a".repeat(40);
  const commitApi = "b".repeat(40);

  let coordinator: AssessmentLifecycleCoordinator;
  let preparation: AssessmentRuntimePreparation;
  const audit = { writeInTx: jest.fn(() => Promise.resolve(undefined)) };

  async function cleanup() {
    await prisma.assessment.deleteMany({ where: { ownerId: userId } });
    await prisma.repositoryConnection.deleteMany({ where: { userId } });
  }

  /** A real assessment in PREPARING: canonical rows via the lifecycle coordinator, then the case. */
  async function newAssessment() {
    const id = randomUUID();
    await prisma.assessment.create({
      data: { id, ownerId: userId, name: `multi-repo ${id}` },
    });
    await coordinator.initialize({
      assessmentId: id,
      ownerId: userId,
      rootAgentVersion: "test",
      checkpointNamespace: id,
      correlationId: "corr",
    });
    await coordinator.transition({
      assessmentId: id,
      expectedRevision: 0,
      toState: "PREPARING",
      correlationId: "corr",
      actorId: userId,
    });
    await prisma.assessmentCase.create({
      data: { assessmentId: id, ruleSetVersionId },
    });
    return id;
  }

  async function candidate(
    assessmentId: string,
    options: { fullName: string; commit: string; prefix?: string | null },
    connectionId?: string,
  ) {
    const connection =
      connectionId ??
      (
        await prisma.repositoryConnection.create({
          data: {
            id: `conn-${randomUUID()}`,
            assessmentId,
            userId,
            installationId: `inst-${randomUUID()}`,
            repositoryId: `repo-${randomUUID()}`,
            repositoryName: options.fullName.split("/")[1],
            repositoryFullName: options.fullName,
            defaultBranch: "main",
            permissions: {},
            status: "ACTIVE",
          },
        })
      ).id;
    const found = await prisma.repositoryConnection.findUniqueOrThrow({
      where: { id: connection },
    });
    const snapshot = await prisma.repositorySnapshot.create({
      data: {
        id: randomUUID(),
        assessmentId,
        connectionId: connection,
        repositoryId: found.repositoryId,
        repositoryFullName: options.fullName,
        branch: "main",
        commitSha: options.commit,
        sourcePathPrefix: options.prefix ?? null,
        providerMetadata: {},
        actorId: userId,
        status: "READY",
      },
    });
    return { connectionId: connection, snapshotId: snapshot.id };
  }

  /** A strict worker discovery artifact for one repository (its own id, commit and source scope). */
  function artifact(coordinates: {
    repositoryId: string;
    commitSha: string;
    sourcePathPrefix: string | null;
    path: string;
  }): SubmitRepositoryDiscovery {
    const sha = (character: string) => `sha256:${character.repeat(64)}`;
    const base = {
      repositoryId: coordinates.repositoryId,
      commitSha: coordinates.commitSha,
      sourcePathPrefix: coordinates.sourcePathPrefix,
      scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
      discoveryVersion: REPOSITORY_DISCOVERY_VERSIONS.v1,
      scannerSignature: sha("1"),
      graphIndexVersion: sha("2"),
      cacheIdentity: sha("0"),
      sourceRanges: [
        {
          rangeId: sha("3"),
          path: coordinates.path,
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
          explanation: "Direct model call; production reachability unknown.",
          callers: [],
          callees: [],
          unresolvedEdges: [],
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
          unresolvedQuestions: [],
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
      generatedAt: "2026-11-26T10:00:00.000Z",
    } satisfies Omit<
      SubmitRepositoryDiscovery,
      "discoveryId" | "contentDigest"
    >;
    const cacheIdentity = computeRepositoryDiscoveryCacheIdentity(base);
    const contentDigest = computeRepositoryDiscoveryDigest({
      ...base,
      cacheIdentity,
    });
    return {
      ...base,
      cacheIdentity,
      contentDigest,
      discoveryId: contentDigest,
    };
  }

  const complete = (assessmentId: string, snapshotIds?: string[]) =>
    new CompleteRepositorySetupHandler(
      prisma as unknown as PrismaService,
      audit as never,
      preparation,
    ).execute(
      new CompleteRepositorySetupCommand(
        assessmentId,
        userId,
        "corr",
        null,
        snapshotIds,
      ),
    );

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(dbUrl) });
    await prisma.$connect();
    coordinator = new AssessmentLifecycleCoordinator(
      prisma as unknown as PrismaService,
      new OutboxRepository(prisma as unknown as PrismaService),
    );
    preparation = new AssessmentRuntimePreparation(
      coordinator,
      new OutboxRepository(prisma as unknown as PrismaService),
    );

    const existing = await prisma.complianceRuleSetVersion.findFirst({
      where: { lifecycleState: "ACTIVE" },
      select: { id: true },
    });
    if (existing) {
      ruleSetVersionId = existing.id;
    } else {
      createdRuleSet = true;
      legalSourceId = randomUUID();
      prepRunId = randomUUID();
      ruleSetVersionId = randomUUID();
      await prisma.legalSourceVersion.create({
        data: {
          id: legalSourceId,
          version: `legalSource-${suffix}`,
          status: "ACTIVE",
          sourceManifest: {},
        },
      });
      await prisma.ruleSetPreparationRun.create({
        data: {
          id: prepRunId,
          idempotencyKey: `prep-${suffix}`,
          legalSourceVersionId: legalSourceId,
          requestedBy: userId,
          correlationId: `corr-${suffix}`,
          executionState: "SUCCEEDED",
        },
      });
      await prisma.complianceRuleSetVersion.create({
        data: {
          id: ruleSetVersionId,
          version: `ruleset-${suffix}`,
          legalSourceVersionId: legalSourceId,
          preparationRunId: prepRunId,
          lifecycleState: "ACTIVE",
          ruleSetDigest: "f".repeat(64),
          validationOutcome: "PASSED",
          activatedAt: new Date(),
        },
      });
    }
    if (
      !(await prisma.assessmentRule.findFirst({ where: { ruleSetVersionId } }))
    ) {
      createdRuleId = randomUUID();
      await prisma.assessmentRule.create({
        data: {
          id: createdRuleId,
          ruleSetVersionId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          concept: "security",
          legalIntent: "intent",
          applicabilityGuidance: "guidance",
          criteria: [],
          contract: {},
          sourceFingerprint: "fingerprint",
          contentDigest: "content-digest",
          ordinal: 1,
        },
      });
    }
    await prisma.user.create({
      data: {
        id: userId,
        email: `${suffix}@multi-repo.test`,
        passwordHash: "hash",
        emailVerified: true,
        failedLoginCount: 0,
        role: "CUSTOMER",
      },
    });
  });

  afterAll(async () => {
    try {
      await cleanup();
      await prisma.user.deleteMany({ where: { id: userId } });
      if (createdRuleSet) {
        await prisma.complianceRuleSetVersion.update({
          where: { id: ruleSetVersionId },
          data: { lifecycleState: "SUPERSEDED", supersededAt: new Date() },
        });
        if (legalSourceId)
          await prisma.legalSourceVersion.update({
            where: { id: legalSourceId },
            data: { status: "SUPERSEDED" },
          });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    audit.writeInTx.mockClear();
    await cleanup();
  });

  it("pins two repositories as one immutable set that the database and the readers accept", async () => {
    const assessmentId = await newAssessment();
    const web = await candidate(assessmentId, {
      fullName: "acme/web-app",
      commit: commitWeb,
      prefix: "apps/web",
    });
    const api = await candidate(assessmentId, {
      fullName: "acme/billing-api",
      commit: commitApi,
    });

    const result = await prisma.$transaction((tx) =>
      preparation.pinRuntimeInputsInTx(tx, {
        assessmentId,
        snapshotIds: [web.snapshotId, api.snapshotId],
        correlationId: "corr",
      }),
    );
    expect(result.result).toBe("PINNED");

    const pins = await prisma.assessmentCaseRepository.findMany({
      where: { assessmentId },
      orderBy: { ordinal: "asc" },
    });
    expect(pins.map((pin) => [pin.repositoryKey, pin.ordinal])).toEqual([
      ["web-app", 0],
      ["billing-api", 1],
    ]);
    const stored = await prisma.assessmentCase.findUniqueOrThrow({
      where: { assessmentId },
    });
    expect(stored).toMatchObject({
      repositoryCount: 2,
      repositorySnapshotId: web.snapshotId,
      repositoryCommit: commitWeb,
    });
    expect(stored.repositorySetDigest).toBe(
      computeRepositorySetDigest(
        pins.map((pin) => ({
          repositoryKey: pin.repositoryKey,
          ordinal: pin.ordinal,
          repositorySnapshotId: pin.repositorySnapshotId,
          repositoryCommit: pin.repositoryCommit,
          sourcePathPrefix: pin.sourcePathPrefix,
        })),
      ),
    );
    // Every repository has its own hydration ticket and the primary ticket is mirrored on the case.
    const tickets = await prisma.repositoryScanJob.findMany({
      where: { assessmentId },
    });
    expect(tickets).toHaveLength(2);
    expect(stored.repositoryScanJobId).toBe(
      tickets.find((ticket) => ticket.snapshotId === web.snapshotId)?.id,
    );

    // The authoritative reader returns the verified set.
    const loaded = await new AssessmentCaseSupport().loadPins(
      prisma,
      assessmentId,
      "corr",
    );
    expect(loaded.repositories.map((pin) => pin.repositoryKey)).toEqual([
      "web-app",
      "billing-api",
    ]);
    expect(loaded.repositorySetDigest).toBe(stored.repositorySetDigest);
    expect(loaded.repositorySetRecorded).toBe(true);

    // The database accepts evidence from either pinned repository and refuses a foreign commit.
    const evidence = (repositoryKey: string | null, repositoryCommit: string) =>
      prisma.assessmentEvidence.create({
        data: {
          evidenceId: randomUUID(),
          assessmentId,
          type: "REPOSITORY_SOURCE",
          repositoryCommit,
          repositoryKey,
          contentSha256: `sha256:${"d".repeat(64)}`,
          payload: {},
        },
      });
    await expect(evidence("web-app", commitWeb)).resolves.toBeDefined();
    await expect(evidence("billing-api", commitApi)).resolves.toBeDefined();
    await expect(evidence("billing-api", commitWeb)).rejects.toThrow();
    await expect(evidence(null, "c".repeat(40))).rejects.toThrow();

    // A retry of the identical selection is a no-op; any other set is refused by the immutable pins.
    await expect(
      prisma.$transaction((tx) =>
        preparation.pinRuntimeInputsInTx(tx, {
          assessmentId,
          snapshotIds: [web.snapshotId, api.snapshotId],
          correlationId: "corr",
        }),
      ),
    ).resolves.toEqual({ result: "PINNED" });
    await expect(
      prisma.$transaction((tx) =>
        preparation.pinRuntimeInputsInTx(tx, {
          assessmentId,
          snapshotIds: [api.snapshotId],
          correlationId: "corr",
        }),
      ),
    ).rejects.toMatchObject({
      response: {
        problem: { code: REPOSITORY_SET_ERROR_CODES.immutable },
      },
    });
    expect(
      await prisma.assessmentCaseRepository.count({ where: { assessmentId } }),
    ).toBe(2);
  });

  it("discovers every pinned repository on its own run and files each artifact under its own pin", async () => {
    const assessmentId = await newAssessment();
    const web = await candidate(assessmentId, {
      fullName: "acme/web-app",
      commit: commitWeb,
    });
    const api = await candidate(assessmentId, {
      fullName: "acme/billing-api",
      commit: commitApi,
      prefix: "services/billing",
    });
    await complete(assessmentId, [web.snapshotId, api.snapshotId]);
    await prisma.assessmentCase.update({
      where: { assessmentId },
      data: { auditMode: "CUSTOMER_SELECTED" },
    });
    const repositoryOf = async (connectionId: string) =>
      (
        await prisma.repositoryConnection.findUniqueOrThrow({
          where: { id: connectionId },
        })
      ).repositoryId;
    const webRepositoryId = await repositoryOf(web.connectionId);
    const apiRepositoryId = await repositoryOf(api.connectionId);

    const outbox = new OutboxRepository(prisma as unknown as PrismaService);
    const support = new AssessmentCaseSupport();
    const discoveries = new AssessmentRepositoryDiscoveryService(
      prisma as unknown as PrismaService,
      {} as never,
      support,
    );
    const runs = new AssessmentDiscoveryRunService(
      prisma as unknown as PrismaService,
      outbox,
      support,
      discoveries,
    );
    const owner = { assessmentId, ownerId: userId, correlationId: "corr" };

    // One action creates one run and one durable command per pinned repository, in a single batch.
    const idempotencyKey = randomUUID();
    const batch = await runs.start({ ...owner, idempotencyKey });
    expect(batch.runs.map((run) => run.repositoryKey)).toEqual([
      "web-app",
      "billing-api",
    ]);
    expect(batch.run.repositoryKey).toBe("web-app");
    expect(new Set(batch.runs.map((run) => run.discoveryBatchId)).size).toBe(1);
    expect(batch.runs[1]).toMatchObject({
      repositorySnapshotId: api.snapshotId,
      repositoryCommit: commitApi,
      sourcePathPrefix: "services/billing",
    });
    const stored = await prisma.assessmentDiscoveryRun.findMany({
      where: { assessmentId },
      orderBy: { requestedAt: "asc" },
    });
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((run) => run.idempotencyKey)).size).toBe(2);
    const commands = await prisma.outboxMessage.count({
      where: {
        aggregateId: assessmentId,
        eventType: ASSESSMENT_DISCOVERY_COMMAND_TYPES.DISCOVERY_REQUESTED,
      },
    });
    expect(commands).toBe(2);

    // The identical request is a replay, and a second scan cannot overlap an active one.
    const replay = await runs.start({ ...owner, idempotencyKey });
    expect(replay.runs.map((run) => run.runId)).toEqual(
      batch.runs.map((run) => run.runId),
    );
    await expect(
      runs.start({ ...owner, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.assessmentDiscoveryRun.count({ where: { assessmentId } }),
    ).toBe(2);

    // Each worker claims its own repository coordinates.
    const [webRun, apiRun] = batch.runs;
    const webClaim = await runs.claim({
      assessmentId,
      runId: webRun.runId,
      correlationId: "corr",
    });
    const apiClaim = await runs.claim({
      assessmentId,
      runId: apiRun.runId,
      correlationId: "corr",
    });
    expect(apiClaim).toMatchObject({
      repositoryKey: "billing-api",
      repositorySnapshotId: api.snapshotId,
      repositoryId: apiRepositoryId,
      repositoryCommit: commitApi,
      sourcePathPrefix: "services/billing",
    });

    const webArtifact = artifact({
      repositoryId: webRepositoryId,
      commitSha: commitWeb,
      sourcePathPrefix: null,
      path: "src/model.ts",
    });
    const apiArtifact = artifact({
      repositoryId: apiRepositoryId,
      commitSha: commitApi,
      sourcePathPrefix: "services/billing",
      path: "services/billing/charge.py",
    });

    // A run can only settle with an artifact of its own repository.
    await expect(
      runs.complete({
        assessmentId,
        runId: webRun.runId,
        correlationId: "corr",
        leaseToken: webClaim.leaseToken,
        discovery: apiArtifact,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      await prisma.assessmentRepositoryDiscovery.count({
        where: { assessmentId },
      }),
    ).toBe(0);

    const apiDone = await runs.complete({
      assessmentId,
      runId: apiRun.runId,
      correlationId: "corr",
      leaseToken: apiClaim.leaseToken,
      discovery: apiArtifact,
    });
    const webDone = await runs.complete({
      assessmentId,
      runId: webRun.runId,
      correlationId: "corr",
      leaseToken: webClaim.leaseToken,
      discovery: webArtifact,
    });
    const records = await prisma.assessmentRepositoryDiscovery.findMany({
      where: { assessmentId },
    });
    expect(
      Object.fromEntries(
        records.map((record) => [record.recordId, record.repositorySnapshotId]),
      ),
    ).toEqual({
      [apiDone.recordId]: api.snapshotId,
      [webDone.recordId]: web.snapshotId,
    });

    // The owner restores the whole batch, each repository with its own verified result.
    const latest = await runs.latest(owner);
    expect(latest.available).toBe(true);
    if (!latest.available) return;
    expect(latest.runs.map((run) => [run.repositoryKey, run.status])).toEqual([
      ["web-app", "COMPLETED"],
      ["billing-api", "COMPLETED"],
    ]);
    expect(
      latest.runs.map((run) =>
        run.discovery.available ? run.discovery.discovery.repositoryKey : null,
      ),
    ).toEqual(["web-app", "billing-api"]);

    // A leased reader selects a repository by key, and a record's pages follow the record's repository.
    const bySummary = await discoveries.getOwnerSummary({
      ...owner,
      repositoryKey: "billing-api",
    });
    expect(bySummary.discovery?.recordId).toBe(apiDone.recordId);
    const page = await discoveries.getOwnerDetailPage({
      ...owner,
      recordId: apiDone.recordId,
      collection: DISCOVERY_DETAIL_COLLECTIONS.aiUseCases,
      offset: 0,
      limit: 10,
    });
    expect(page.total).toBe(1);
    await expect(
      discoveries.getOwnerSummary({ ...owner, repositoryKey: "mobile" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("shows the chosen repositories before pinning and the pinned set with keys after completion", async () => {
    const assessmentId = await newAssessment();
    const web = await candidate(assessmentId, {
      fullName: "acme/web-app",
      commit: commitWeb,
    });
    const api = await candidate(assessmentId, {
      fullName: "acme/billing-api",
      commit: commitApi,
    });
    const loader = new AssessmentRepositorySetupLoader(
      prisma as unknown as PrismaService,
    );
    const view = () =>
      loader.load({
        assessmentId,
        sessionUserId: userId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr",
      });

    const before = await view();
    expect(before.repositories.map((entry) => entry.snapshot?.id)).toEqual([
      web.snapshotId,
      api.snapshotId,
    ]);
    expect(before.setupCompleted).toBe(false);

    const completed = await complete(assessmentId, [
      api.snapshotId,
      web.snapshotId,
    ]);
    expect(completed.repositories.map((r) => r.repository_key)).toEqual([
      "billing-api",
      "web-app",
    ]);
    expect(completed.repository_set_digest).toMatch(/^sha256:/u);
    expect(completed.snapshot_id).toBe(api.snapshotId);

    const after = await view();
    expect(after.setupCompleted).toBe(true);
    expect(after.repositories.map((entry) => entry.repositoryKey)).toEqual([
      "billing-api",
      "web-app",
    ]);
    expect(after.repositorySetDigest).toBe(completed.repository_set_digest);
    expect(audit.writeInTx).toHaveBeenCalledTimes(1);
  });

  it("completes through the legacy single-repository call and replays idempotently once ACTIVE", async () => {
    const assessmentId = await newAssessment();
    const web = await candidate(assessmentId, {
      fullName: "acme/web-app",
      commit: commitWeb,
    });
    const first = await complete(assessmentId);
    expect(first.snapshot_id).toBe(web.snapshotId);
    expect(first.repositories).toHaveLength(1);
  });

  it("refuses to complete with a snapshot of another assessment or an unknown one, pinning nothing", async () => {
    const assessmentId = await newAssessment();
    const other = await newAssessment();
    const web = await candidate(assessmentId, {
      fullName: "acme/web-app",
      commit: commitWeb,
    });
    const foreign = await candidate(other, {
      fullName: "acme/other",
      commit: commitApi,
    });

    await expect(
      complete(assessmentId, [web.snapshotId, foreign.snapshotId]),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        problem: { meta: { missingSnapshotIds: foreign.snapshotId } },
      },
    });
    expect(
      await prisma.assessmentCaseRepository.count({ where: { assessmentId } }),
    ).toBe(0);
  });

  it("removes a candidate repository while preparing and refuses once the set is pinned", async () => {
    const assessmentId = await newAssessment();
    const web = await candidate(assessmentId, {
      fullName: "acme/web-app",
      commit: commitWeb,
    });
    const api = await candidate(assessmentId, {
      fullName: "acme/billing-api",
      commit: commitApi,
    });
    const remove = (snapshotId: string) =>
      new RemoveAssessmentRepositoryHandler(
        prisma as unknown as PrismaService,
        audit as never,
      ).execute(
        new RemoveAssessmentRepositoryCommand(
          assessmentId,
          snapshotId,
          userId,
          "corr",
        ),
      );

    await expect(remove(api.snapshotId)).resolves.toMatchObject({
      connection_id: api.connectionId,
      connection_revoked: true,
    });
    expect(
      await prisma.repositorySnapshot.count({ where: { assessmentId } }),
    ).toBe(1);
    expect(
      (
        await prisma.repositoryConnection.findUniqueOrThrow({
          where: { id: api.connectionId },
        })
      ).status,
    ).toBe("REVOKED");

    await complete(assessmentId, [web.snapshotId]);
    await expect(remove(web.snapshotId)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await prisma.repositorySnapshot.count({ where: { assessmentId } }),
    ).toBe(1);
  });

  it("keeps a connection that still has another source scope when one scope is removed", async () => {
    const assessmentId = await newAssessment();
    const first = await candidate(assessmentId, {
      fullName: "acme/monorepo",
      commit: commitWeb,
      prefix: "apps/web",
    });
    const second = await candidate(
      assessmentId,
      { fullName: "acme/monorepo", commit: commitWeb, prefix: "apps/admin" },
      first.connectionId,
    );

    const result = await new RemoveAssessmentRepositoryHandler(
      prisma as unknown as PrismaService,
      audit as never,
    ).execute(
      new RemoveAssessmentRepositoryCommand(
        assessmentId,
        second.snapshotId,
        userId,
        "corr",
      ),
    );

    expect(result.connection_revoked).toBe(false);
    expect(
      (
        await prisma.repositoryConnection.findUniqueOrThrow({
          where: { id: first.connectionId },
        })
      ).status,
    ).toBe("ACTIVE");
  });

  it("pins the same repository twice with different source scopes under distinct keys", async () => {
    const assessmentId = await newAssessment();
    const first = await candidate(assessmentId, {
      fullName: "acme/monorepo",
      commit: commitWeb,
      prefix: "apps/web",
    });
    const second = await candidate(
      assessmentId,
      { fullName: "acme/monorepo", commit: commitWeb, prefix: "apps/admin" },
      first.connectionId,
    );

    const completed = await complete(assessmentId, [
      first.snapshotId,
      second.snapshotId,
    ]);

    expect(completed.repositories.map((r) => r.repository_key)).toEqual([
      "monorepo",
      "monorepo-2",
    ]);
  });
});
