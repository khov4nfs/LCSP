import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { HUMAN_RESOLUTION_REQUEST_STATUSES } from "@lcsp/contracts/assessment";
import {
  TRACKING_ACTION_REASONS,
  TRACKING_CHANGE_TYPES,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentTrackingLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-tracking.loader.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";

const dbUrl =
  process.env.DATABASE_URL ??
  process.env.PHASE25_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public";

describe("AssessmentTrackingLoader Real PostgreSQL Integration & SQL Parity", () => {
  let prisma: PrismaClient;
  let loader: AssessmentTrackingLoader;

  const testSuffix = randomUUID();
  const userId = `user-parity-${testSuffix}`;
  const commitSha = "a000000000000000000000000000000000000001";

  let legalSourceId: string;
  let prepRunId: string;
  let ruleSetVersionId: string;

  async function cleanup() {
    await prisma.repositoryScanJob.deleteMany({
      where: { assessment: { ownerId: userId } },
    });
    await prisma.repositorySnapshot.deleteMany({
      where: { assessment: { ownerId: userId } },
    });
    await prisma.repositoryConnection.deleteMany({ where: { userId } });
    await prisma.assessment.deleteMany({ where: { ownerId: userId } });
  }

  async function seedPinnedRepository(assessmentId: string) {
    const connectionId = `conn-${randomUUID()}`;
    const snapshotId = randomUUID();
    const scanJobId = randomUUID();

    await prisma.repositoryConnection.create({
      data: {
        id: connectionId,
        assessmentId,
        userId,
        installationId: `inst-${connectionId}`,
        repositoryId: `repo-${connectionId}`,
        repositoryName: "test-repo",
        repositoryFullName: "org/test-repo",
        defaultBranch: "main",
        permissions: { contents: "READ" },
        status: "ACTIVE",
      },
    });

    await prisma.repositorySnapshot.create({
      data: {
        id: snapshotId,
        assessmentId,
        connectionId,
        repositoryId: `repo-${connectionId}`,
        repositoryFullName: "org/test-repo",
        branch: "main",
        ref: "refs/heads/main",
        commitSha,
        providerMetadata: { source: "test" },
        actorId: userId,
        status: "READY",
      },
    });

    await prisma.repositoryScanJob.create({
      data: {
        id: scanJobId,
        assessmentId,
        snapshotId,
        idempotencyKey: `scan-${scanJobId}`,
        triggerSource: "MANUAL",
        status: "COMPLETED",
        attemptCount: 1,
        correlationId: `corr-${scanJobId}`,
      },
    });

    return { snapshotId, scanJobId };
  }

  async function resolveDecisionCoverage(
    assessmentId: string,
    ruleId: string,
    decisionId: string,
  ) {
    await prisma.assessmentDecisionCoverage.create({
      data: {
        assessmentId,
        assessmentRuleId: ruleId,
        ruleSetVersionId,
        assessmentRuleVersion: "1.0.0",
        resolutionState: "PENDING",
      },
    });

    await prisma.assessmentDecisionCoverage.update({
      where: {
        assessmentId_assessmentRuleId: {
          assessmentId,
          assessmentRuleId: ruleId,
        },
      },
      data: {
        resolutionState: "INVESTIGATING",
      },
    });

    await prisma.assessmentDecisionCoverage.update({
      where: {
        assessmentId_assessmentRuleId: {
          assessmentId,
          assessmentRuleId: ruleId,
        },
      },
      data: {
        resolutionState: "RESOLVED",
        currentDecisionId: decisionId,
        decisionRevision: 1,
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(dbUrl) });
    await prisma.$connect();
    loader = new AssessmentTrackingLoader(prisma as unknown as PrismaService);

    // Setup or reuse active rule set hierarchy
    const existingRuleSet = await prisma.complianceRuleSetVersion.findFirst({
      where: { lifecycleState: "ACTIVE" },
      select: { id: true },
    });

    if (existingRuleSet) {
      ruleSetVersionId = existingRuleSet.id;
    } else {
      legalSourceId = randomUUID();
      prepRunId = randomUUID();
      ruleSetVersionId = randomUUID();

      await prisma.legalSourceVersion.create({
        data: {
          id: legalSourceId,
          version: `legal-${testSuffix}`,
          status: "ACTIVE",
          sourceManifest: {},
        },
      });

      await prisma.ruleSetPreparationRun.create({
        data: {
          id: prepRunId,
          idempotencyKey: `prep-${testSuffix}`,
          legalSourceVersionId: legalSourceId,
          requestedBy: userId,
          correlationId: `corr-${testSuffix}`,
          executionState: "SUCCEEDED",
        },
      });

      await prisma.complianceRuleSetVersion.create({
        data: {
          id: ruleSetVersionId,
          version: `ruleset-${testSuffix}`,
          legalSourceVersionId: legalSourceId,
          preparationRunId: prepRunId,
          lifecycleState: "ACTIVE",
          ruleSetDigest: "test-digest",
          validationOutcome: "PASSED",
          activatedAt: new Date(),
        },
      });
    }

    const existingRule = await prisma.assessmentRule.findFirst({
      where: { ruleSetVersionId, assessmentRuleId: "RULE-1" },
    });

    if (!existingRule) {
      await prisma.assessmentRule.create({
        data: {
          id: randomUUID(),
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
        email: `${testSuffix}@tracking-parity.test`,
        passwordHash: "hash",
        emailVerified: true,
        failedLoginCount: 0,
        role: "CUSTOMER",
      },
    });
  }, 30_000);

  afterAll(async () => {
    try {
      await cleanup();
      await prisma.user.deleteMany({ where: { id: userId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    await cleanup();
  });

  it("proves SQL summary and per-assessment evaluation agree on COMPLIANT for valid decision on real Postgres", async () => {
    const assessmentId = randomUUID();
    const decisionId = randomUUID();
    const evidenceId = randomUUID();

    await prisma.assessment.create({
      data: {
        id: assessmentId,
        ownerId: userId,
        name: "Valid Decision Assessment",
        lifecycleState: "ACTIVE",
        lifecycleRevision: 1,
      },
    });

    const { snapshotId, scanJobId } = await seedPinnedRepository(assessmentId);

    await prisma.assessmentCase.create({
      data: {
        assessmentId,
        caseRevision: 1,
        ruleSetVersionId,
        repositoryCommit: commitSha,
        repositorySnapshotId: snapshotId,
        repositoryScanJobId: scanJobId,
        pinnedAt: new Date(),
      },
    });

    await prisma.assessmentEvidence.create({
      data: {
        evidenceId,
        assessmentId,
        type: "REPOSITORY_SOURCE",
        state: "ACCEPTED",
        repositoryCommit: commitSha,
        contentSha256: `sha256:${"1".repeat(64)}`,
        payload: { path: "src/index.ts" },
      },
    });

    const validDecisionPayload = {
      assessmentRuleId: "RULE-1",
      assessmentRuleVersion: "1.0.0",
      scopeId: "ASSESSMENT",
      ruleSetVersionId,
      repositorySnapshotId: snapshotId,
      repositoryCommit: commitSha,
      caseRevision: 1,
      legalContextRefs: [{ legalContextId: "legal-1" }],
      applicability: "APPLICABLE",
      compliance: "COMPLIANT",
      rationale: "All criteria verified met.",
      references: [
        {
          type: "ASSESSMENT_EVIDENCE",
          evidenceId,
        },
      ],
      criteria: [
        {
          criterionId: "crit-1",
          outcome: "MET",
          rationale: "Criterion 1 satisfied",
          references: [
            {
              type: "ASSESSMENT_EVIDENCE",
              evidenceId,
            },
          ],
        },
      ],
    };

    await prisma.assessmentRuleDecision.create({
      data: {
        decisionId,
        assessmentId,
        ruleSetVersionId,
        assessmentRuleId: "RULE-1",
        assessmentRuleVersion: "1.0.0",
        scopeId: "ASSESSMENT",
        decisionRevision: 1,
        state: "ACCEPTED",
        applicability: "APPLICABLE",
        compliance: "COMPLIANT",
        repositoryCommit: commitSha,
        caseRevision: 1,
        idempotencyKey: `idemp-${decisionId}`,
        requestDigest: "digest",
        decision: validDecisionPayload,
      },
    });

    await resolveDecisionCoverage(assessmentId, "RULE-1", decisionId);

    const result = await loader.loadCustomerOverview({
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: `corr-parity-valid-${randomUUID()}`,
    });

    // Real PostgreSQL summary and detail agreement
    expect(result.complianceSummary.compliantCount).toBe(1);
    expect(result.complianceSummary.unresolvedCount).toBe(0);
    expect(result.assessments[0].compliance.compliantCount).toBe(1);
    expect(result.assessments[0].compliance.unresolvedCount).toBe(0);
  });

  it("proves SQL summary rejects structurally invalid decision (empty criteria/references) with 100% parity to per-assessment evaluation", async () => {
    const assessmentId = randomUUID();
    const decisionId = randomUUID();

    await prisma.assessment.create({
      data: {
        id: assessmentId,
        ownerId: userId,
        name: "Malformed Decision Assessment",
        lifecycleState: "ACTIVE",
        lifecycleRevision: 1,
      },
    });

    const { snapshotId, scanJobId } = await seedPinnedRepository(assessmentId);

    await prisma.assessmentCase.create({
      data: {
        assessmentId,
        caseRevision: 1,
        ruleSetVersionId,
        repositoryCommit: commitSha,
        repositorySnapshotId: snapshotId,
        repositoryScanJobId: scanJobId,
        pinnedAt: new Date(),
      },
    });

    // ACCEPTED row in DB with matching columns, BUT invalid decision JSON (criteria: [], references: [])
    const malformedDecisionPayload = {
      assessmentRuleId: "RULE-1",
      assessmentRuleVersion: "1.0.0",
      scopeId: "ASSESSMENT",
      ruleSetVersionId,
      repositorySnapshotId: snapshotId,
      repositoryCommit: commitSha,
      caseRevision: 1,
      legalContextRefs: [{ legalContextId: "legal-1" }],
      applicability: "APPLICABLE",
      compliance: "COMPLIANT",
      rationale:
        "Rule claimed compliant but criteria and references are empty arrays",
      references: [], // Violates .min(1)
      criteria: [], // Violates .min(1) for APPLICABLE
    };

    await prisma.assessmentRuleDecision.create({
      data: {
        decisionId,
        assessmentId,
        ruleSetVersionId,
        assessmentRuleId: "RULE-1",
        assessmentRuleVersion: "1.0.0",
        scopeId: "ASSESSMENT",
        decisionRevision: 1,
        state: "ACCEPTED",
        applicability: "APPLICABLE",
        compliance: "COMPLIANT",
        repositoryCommit: commitSha,
        caseRevision: 1,
        idempotencyKey: `idemp-${decisionId}`,
        requestDigest: "digest",
        decision: malformedDecisionPayload,
      },
    });

    await resolveDecisionCoverage(assessmentId, "RULE-1", decisionId);

    const result = await loader.loadCustomerOverview({
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: `corr-parity-malformed-${randomUUID()}`,
    });

    // Real PostgreSQL production SQL query MUST reject this decision as unresolved, matching per-assessment SafeParse!
    expect(result.complianceSummary.compliantCount).toBe(0);
    expect(result.complianceSummary.unresolvedCount).toBe(1);
    expect(result.assessments[0].compliance.compliantCount).toBe(0);
    expect(result.assessments[0].compliance.unresolvedCount).toBe(1);
  });

  it("proves SQL summary rejects decision with mismatched assessmentRuleId in decision payload", async () => {
    const assessmentId = randomUUID();
    const decisionId = randomUUID();

    await prisma.assessment.create({
      data: {
        id: assessmentId,
        ownerId: userId,
        name: "Mismatched Rule Assessment",
        lifecycleState: "ACTIVE",
        lifecycleRevision: 1,
      },
    });

    const { snapshotId, scanJobId } = await seedPinnedRepository(assessmentId);

    await prisma.assessmentCase.create({
      data: {
        assessmentId,
        caseRevision: 1,
        ruleSetVersionId,
        repositoryCommit: commitSha,
        repositorySnapshotId: snapshotId,
        repositoryScanJobId: scanJobId,
        pinnedAt: new Date(),
      },
    });

    // Decision row has assessmentRuleId = "RULE-1", but internal payload says "RULE-OTHER"
    const mismatchedPayload = {
      assessmentRuleId: "RULE-OTHER",
      assessmentRuleVersion: "1.0.0",
      scopeId: "ASSESSMENT",
      ruleSetVersionId,
      repositorySnapshotId: snapshotId,
      repositoryCommit: commitSha,
      caseRevision: 1,
      legalContextRefs: [{ legalContextId: "legal-1" }],
      applicability: "APPLICABLE",
      compliance: "COMPLIANT",
      rationale: "Different rule ID in payload",
      references: [
        {
          type: "ASSESSMENT_EVIDENCE",
          evidenceId: randomUUID(),
        },
      ],
      criteria: [
        {
          criterionId: "crit-1",
          outcome: "MET",
          rationale: "Criterion met",
          references: [
            {
              type: "ASSESSMENT_EVIDENCE",
              evidenceId: randomUUID(),
            },
          ],
        },
      ],
    };

    await prisma.assessmentRuleDecision.create({
      data: {
        decisionId,
        assessmentId,
        ruleSetVersionId,
        assessmentRuleId: "RULE-1",
        assessmentRuleVersion: "1.0.0",
        scopeId: "ASSESSMENT",
        decisionRevision: 1,
        state: "ACCEPTED",
        applicability: "APPLICABLE",
        compliance: "COMPLIANT",
        repositoryCommit: commitSha,
        caseRevision: 1,
        idempotencyKey: `idemp-${decisionId}`,
        requestDigest: "digest",
        decision: mismatchedPayload,
      },
    });

    await resolveDecisionCoverage(assessmentId, "RULE-1", decisionId);

    const result = await loader.loadCustomerOverview({
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: `corr-parity-mismatched-${randomUUID()}`,
    });

    // Mismatched assessmentRuleId in decision must cause SQL summary and detail to reject it as compliant
    expect(result.complianceSummary.compliantCount).toBe(0);
    expect(result.complianceSummary.unresolvedCount).toBe(1);
    expect(result.assessments[0].compliance.compliantCount).toBe(0);
    expect(result.assessments[0].compliance.unresolvedCount).toBe(1);
  });

  it("surfaces pending action and material change from assessment beyond page 1 on real PostgreSQL", async () => {
    const totalAssessments = 51;
    const assessmentIds: string[] = [];

    // Create 51 assessments
    for (let i = 0; i < totalAssessments; i++) {
      const aId = randomUUID();
      assessmentIds.push(aId);
      await prisma.assessment.create({
        data: {
          id: aId,
          ownerId: userId,
          name: `Asmt ${i + 1}`,
          // The oldest assessment (i=0) is COMPLETE and has an active FINAL_REPORT
          lifecycleState: i === 0 ? "COMPLETE" : "ACTIVE",
          lifecycleRevision: 1,
          // The 51st assessment is created with older updatedAt so it sits on page 2 when sorted updatedAt desc
          createdAt: new Date(Date.now() - (totalAssessments - i) * 60_000),
          updatedAt: new Date(Date.now() - (totalAssessments - i) * 60_000),
        },
      });

      const { snapshotId, scanJobId } = await seedPinnedRepository(aId);

      await prisma.assessmentCase.create({
        data: {
          assessmentId: aId,
          caseRevision: 1,
          ruleSetVersionId,
          repositoryCommit: commitSha,
          repositorySnapshotId: snapshotId,
          repositoryScanJobId: scanJobId,
          pinnedAt: new Date(),
        },
      });
    }

    const offPageAssessmentId = assessmentIds[0]; // Oldest assessment, will be on page 2 with limit 50
    const requestId = randomUUID();
    const threadId = randomUUID();
    const artifactId = randomUUID();

    // Attach runtime thread and OPEN human request to the off-page assessment
    await prisma.assessmentRuntime.create({
      data: {
        assessmentId: offPageAssessmentId,
        threadId,
        rootAgentVersion: "1.0.0",
        checkpointNamespace: "assessment",
        executionState: "RUNNING",
      },
    });

    await prisma.assessmentHumanRequest.create({
      data: {
        requestId,
        assessmentId: offPageAssessmentId,
        threadId,
        assessmentRuleId: "RULE-1",
        criterionIds: ["crit-1"],
        question: "Please confirm external boundary fact",
        unresolvedFact: "external-boundary",
        decisionImpact: ["impact"],
        resolutionAttempts: [],
        controlType: "FREE_TEXT",
        choices: [],
        status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
        caseRevision: 1,
      },
    });

    const offPageCase = await prisma.assessmentCase.findUniqueOrThrow({
      where: { assessmentId: offPageAssessmentId },
    });

    // Attach active FINAL_REPORT to the off-page assessment
    await prisma.assessmentArtifact.create({
      data: {
        artifactId,
        assessmentId: offPageAssessmentId,
        kind: "FINAL_REPORT",
        lifecycleState: "BUILDING",
        ruleSetVersionId,
        repositorySnapshotId: offPageCase.repositorySnapshotId!,
        repositoryCommit: commitSha,
        caseRevision: 1,
        schemaVersion: "1.0.0",
        storageRef: "/reports/final.pdf",
        contentSha256: `sha256:${"2".repeat(64)}`,
        sizeBytes: 1024,
      },
    });

    await prisma.assessmentArtifact.update({
      where: { artifactId },
      data: {
        lifecycleState: "ACTIVE",
        activatedAt: new Date(),
      },
    });

    // Query Page 1 with limit 50
    const overview = await loader.loadCustomerOverview({
      sessionUserId: userId,
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: `corr-offpage-pg-${randomUUID()}`,
      limit: 50,
      offset: 0,
    });

    expect(overview.pagination.total).toBe(51);
    expect(overview.assessments).toHaveLength(50);
    // Off-page assessment is not on page 1 of assessments
    expect(
      overview.assessments.some((a) => a.assessmentId === offPageAssessmentId),
    ).toBe(false);

    // BUT global actions queue includes the open request from the 51st assessment!
    expect(overview.actions.length).toBeGreaterThanOrEqual(1);
    const action = overview.actions.find((a) => a.requestId === requestId);
    expect(action).toBeDefined();
    expect(action?.assessmentId).toBe(offPageAssessmentId);
    expect(action?.actionReason).toBe(
      TRACKING_ACTION_REASONS.HUMAN_FACT_REQUIRED,
    );

    // AND global changes queue includes the REPORT_READY change from the 51st assessment!
    const change = overview.changes.find(
      (c) =>
        c.assessmentId === offPageAssessmentId &&
        c.changeType === TRACKING_CHANGE_TYPES.REPORT_READY,
    );
    expect(change).toBeDefined();
    expect(change?.destinationUrl).toBe(
      `/assessments/${offPageAssessmentId}/report?artifactId=${artifactId}`,
    );
  }, 60_000);
});
