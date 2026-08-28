/** MW-rec-003: Resolve Conflict Endpoint. */

import * as assert from "node:assert/strict";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AI_USAGE_FLOW_STATUSES,
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  TECHNICAL_PROFILE_STATUSES,
  type ConflictRecordStatus,
} from "@lcsp/contracts/scan";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedRepositoryScanGraph,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

type ResolveConflictDto = {
  conflict_id: string;
  status: ConflictRecordStatus;
  resolved_at: string;
  all_conflicts_resolved: boolean;
  correlationId: string;
};

describe("Resolve Conflict Endpoint (e2e) [MW-rec-003]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetDomainData(prisma);
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await seedAssessmentChain(prisma, "assessment-1");
    await seedConflicts(prisma, "assessment-1", [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.pending },
      { id: "conflict-2", status: CONFLICT_RECORD_STATUSES.pending },
    ]);
    managerToken = await signIn(app, "manager@acme.test");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01 resolves a pending conflict and writes audit with resolver ID", async () => {
    const response = await resolveConflict(app, managerToken, "conflict-1", {
      resolution: CONFLICT_RECORD_STATUSES.resolved,
      resolution_note: "Manager accepts the technical evidence basis.",
    });
    const body = successBody<ResolveConflictDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.conflict_id, "conflict-1");
    assert.equal(body.status, CONFLICT_RECORD_STATUSES.resolved);
    assert.equal(body.all_conflicts_resolved, false);
    assert.ok(body.resolved_at);
    assert.ok(body.correlationId);

    const [record, audit] = await Promise.all([
      prisma.conflictRecord.findUniqueOrThrow({ where: { id: "conflict-1" } }),
      prisma.auditEvent.findFirstOrThrow({
        where: { eventType: SCAN_EVENT_TYPES.conflictResolvedAudit },
      }),
    ]);
    assert.equal(record.resolvedById, "user-1");
    assert.equal(audit.actorId, "user-1");
    assert.equal(audit.decision, AUDIT_DECISIONS.allow);
  });

  it("T02 dismisses a pending conflict", async () => {
    const response = await resolveConflict(app, managerToken, "conflict-1", {
      resolution: CONFLICT_RECORD_STATUSES.dismissed,
      resolution_note: "Manager determined this conflict is not material.",
    });
    const body = successBody<ResolveConflictDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.status, CONFLICT_RECORD_STATUSES.dismissed);
    const record = await prisma.conflictRecord.findUniqueOrThrow({
      where: { id: "conflict-1" },
    });
    assert.equal(
      record.resolutionNote,
      "Manager determined this conflict is not material.",
    );
  });

  it("T03 emits all-conflicts-resolved when the last pending conflict is resolved", async () => {
    await resolveConflict(app, managerToken, "conflict-1", {
      resolution: CONFLICT_RECORD_STATUSES.resolved,
    });

    const response = await resolveConflict(app, managerToken, "conflict-2", {
      resolution: CONFLICT_RECORD_STATUSES.resolved,
    });
    const body = successBody<ResolveConflictDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.all_conflicts_resolved, true);
    assert.equal(
      await prisma.outboxMessage.count({
        where: {
          eventType: SCAN_EVENT_TYPES.reconciliationAllConflictsResolved,
        },
      }),
      1,
    );
  });

  it("T04 rejects already resolved conflicts as immutable", async () => {
    await prisma.conflictRecord.update({
      where: { id: "conflict-1" },
      data: {
        status: CONFLICT_RECORD_STATUSES.resolved,
        resolvedAt: new Date(),
        resolvedById: "user-1",
      },
    });

    const response = await resolveConflict(app, managerToken, "conflict-1", {
      resolution: CONFLICT_RECORD_STATUSES.dismissed,
      resolution_note: "Already addressed in current Manager review.",
    });

    assertError(
      response.status,
      response.body,
      409,
      SCAN_ERROR_CODES.conflictAlreadyResolved,
    );
  });

  it("T06 returns not found for a missing conflict", async () => {
    const response = await httpRequest(app)
      .patch("/assessments/assessment-1/conflicts/conflict-missing/resolve")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ resolution: CONFLICT_RECORD_STATUSES.resolved });

    assertError(
      response.status,
      response.body,
      404,
      SCAN_ERROR_CODES.conflictNotFound,
    );
  });

  it("T07 emits all-conflicts-resolved only when no pending conflicts remain", async () => {
    await resolveConflict(app, managerToken, "conflict-1", {
      resolution: CONFLICT_RECORD_STATUSES.dismissed,
      resolution_note: "Conflict is not material for this assessment.",
    });
    assert.equal(
      await prisma.outboxMessage.count({
        where: {
          eventType: SCAN_EVENT_TYPES.reconciliationAllConflictsResolved,
        },
      }),
      0,
    );

    await resolveConflict(app, managerToken, "conflict-2", {
      resolution: CONFLICT_RECORD_STATUSES.dismissed,
      resolution_note: "Remaining conflict is intentionally dismissed.",
    });
    assert.equal(
      await prisma.outboxMessage.count({
        where: {
          eventType: SCAN_EVENT_TYPES.reconciliationAllConflictsResolved,
        },
      }),
      1,
    );
  });

  it("T08 rejects dismissal without a non-empty reason", async () => {
    const missingReason = await resolveConflict(
      app,
      managerToken,
      "conflict-1",
      { resolution: CONFLICT_RECORD_STATUSES.dismissed },
    );
    assertError(
      missingReason.status,
      missingReason.body,
      422,
      SCAN_ERROR_CODES.conflictSchemaInvalid,
    );

    const blankReason = await resolveConflict(app, managerToken, "conflict-1", {
      resolution: CONFLICT_RECORD_STATUSES.dismissed,
      resolution_note: "   ",
    });
    assertError(
      blankReason.status,
      blankReason.body,
      422,
      SCAN_ERROR_CODES.conflictSchemaInvalid,
    );
  });
});

async function resetDomainData(prisma: PrismaClient): Promise<void> {
  await prisma.conflictRecord.deleteMany();
  await prisma.aIUsageFlow.deleteMany();
  await prisma.technicalProfile.deleteMany();
  await prisma.technicalEvidenceReport.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.assessment.deleteMany();
}

async function seedAssessmentChain(
  prisma: PrismaClient,
  assessmentId: string,
): Promise<void> {
  await prisma.assessment.create({
    data: {
      id: assessmentId,
      ownerId: "user-1",
      name: `Assessment ${assessmentId}`,
      status: ASSESSMENT_STATUS_CODES.scanInProgress,
    },
  });
  await seedRepositoryScanGraph(prisma, {
    assessmentId,
    userId: "user-1",
    connectionId: `connection-${assessmentId}`,
    snapshotId: `snapshot-${assessmentId}`,
    scanJobId: `scan-job-${assessmentId}`,
  });
  await prisma.technicalEvidenceReport.create({
    data: {
      id: `evidence-${assessmentId}`,
      scanJobId: `scan-job-${assessmentId}`,
      assessmentId,
      snapshotId: `snapshot-${assessmentId}`,
      toolsVersion: { semgrep: "1.0.0" },
      configHash: { semgrep: "sha256:abc" },
      evidencePayload: {
        findings: [{ finding_id: `finding-${assessmentId}` }],
      },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      schemaVersion: "1.0.0",
      status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
    },
  });
  await prisma.technicalProfile.create({
    data: {
      id: `technical-profile-${assessmentId}`,
      evidenceReportId: `evidence-${assessmentId}`,
      assessmentId,
      schemaVersion: "1.0.0",
      providerVersion: "technical-profile-worker@1.0.0",
      profileData: { aiDetected: "confirmed" },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: TECHNICAL_PROFILE_STATUSES.accepted,
    },
  });
  await prisma.aIUsageFlow.create({
    data: {
      id: `ai-flow-${assessmentId}`,
      technicalProfileId: `technical-profile-${assessmentId}`,
      assessmentId,
      schemaVersion: "1.0.0",
      providerVersion: "ai-usage-flow-worker@1.0.0",
      claims: [{ claim_id: "claim-1" }],
      unknownUsages: [],
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: AI_USAGE_FLOW_STATUSES.accepted,
    },
  });
}

async function seedConflicts(
  prisma: PrismaClient,
  assessmentId: string,
  conflicts: Array<{ id: string; status: ConflictRecordStatus }>,
): Promise<void> {
  await prisma.conflictRecord.createMany({
    data: conflicts.map((conflict, index) => ({
      id: conflict.id,
      aiUsageFlowId: `ai-flow-${assessmentId}`,
      assessmentId,
      conflictType: index === 0 ? "evidence_contradiction" : "scope_mismatch",
      conflictScore: index === 0 ? 0.88 : 0.42,
      scoreExplanation: "Manager and technical evidence differ.",
      evidenceRefs: [`evidence-${assessmentId}::finding-${index + 1}`],
      status: conflict.status,
      ...(conflict.status === CONFLICT_RECORD_STATUSES.pending
        ? {}
        : { resolvedAt: new Date(), resolvedById: "user-1" }),
    })),
  });
}

async function signIn(app: INestApplication, email: string): Promise<string> {
  const response = await httpRequest(app).post("/auth/sign-in").send({
    email,
    password: "CorrectHorseBatteryStaple!",
  });
  return successBody<SignInSuccess>(response).session_token ?? "";
}

function resolveConflict(
  app: INestApplication,
  token: string,
  conflictId: string,
  body: { resolution: string; resolution_note?: string },
) {
  return httpRequest(app)
    .patch(`/assessments/assessment-1/conflicts/${conflictId}/resolve`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function assertError(
  actualStatus: number,
  body: unknown,
  expectedStatus: number,
  expectedCode: string,
): void {
  assert.equal(actualStatus, expectedStatus);
  assert.equal(problemCode(body), expectedCode);
}
