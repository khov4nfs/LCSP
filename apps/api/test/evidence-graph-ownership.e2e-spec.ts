import * as assert from "node:assert/strict";

import { REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import {
  httpRequest,
  problemBody,
  problemCode,
  successBody,
} from "./support/http.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedRepositorySnapshotGraph,
} from "./support/auth-workspace-test-helpers.js";

describe("Program Evidence Graph ownership (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let customerToken: string;
  let adminToken: string;

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
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.repositoryScanJob.deleteMany();
    await prisma.repositorySnapshot.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    customerToken = await signIn(
      "manager@acme.test",
      "CorrectHorseBatteryStaple!",
    );
    adminToken = await signIn("nomembership@acme.test", "NoMembership123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("allows the owner, denies another customer, and preserves admin access", async () => {
    await createAcceptedEvidence("assessment-owned", "user-1");
    await createAcceptedEvidence("assessment-other", "user-2");

    const own = await request("assessment-owned", customerToken);
    assert.equal(own.status, 200);

    const other = await request("assessment-other", customerToken);
    assert.equal(other.status, 404);

    const admin = await request("assessment-other", adminToken);
    assert.equal(admin.status, 200);
  });

  it("returns EVIDENCE_NOT_FOUND when no evidence scan was ever started", async () => {
    await seedRepositorySnapshotGraph(prisma, {
      assessmentId: "assessment-pending-evidence",
      userId: "user-1",
      connectionId: "connection-pending-evidence",
      snapshotId: "snapshot-pending-evidence",
    });

    const pending = await request("assessment-pending-evidence", customerToken);
    assert.equal(pending.status, 404);
    assert.equal(problemCode(pending), EVIDENCE_ERROR_CODES.notFound);
    assert.equal(problemBody(pending).requiredAction, REQUIRED_ACTIONS.none);
  });

  it("returns not-ready while the evidence graph scan is still active", async () => {
    await seedRepositorySnapshotGraph(prisma, {
      assessmentId: "assessment-building-evidence",
      userId: "user-1",
      connectionId: "connection-building-evidence",
      snapshotId: "snapshot-building-evidence",
    });
    await prisma.repositoryScanJob.create({
      data: {
        id: "scan-building-evidence",
        assessmentId: "assessment-building-evidence",
        snapshotId: "snapshot-building-evidence",
        idempotencyKey: "key-building-evidence",
        correlationId: "corr-building-evidence",
        triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
        status: REPOSITORY_SCAN_JOB_STATUSES.running,
      },
    });

    const pending = await request(
      "assessment-building-evidence",
      customerToken,
    );
    assert.equal(pending.status, 202);
    assert.equal(problemCode(pending), EVIDENCE_ERROR_CODES.notReady);
    assert.equal(problemBody(pending).requiredAction, REQUIRED_ACTIONS.none);
    assert.deepEqual(problemBody(pending).meta, {
      scanJobId: "scan-building-evidence",
      scanStatus: REPOSITORY_SCAN_JOB_STATUSES.running,
    });
  });

  it("returns build-failed when the latest evidence scan failed", async () => {
    await seedRepositorySnapshotGraph(prisma, {
      assessmentId: "assessment-failed-evidence",
      userId: "user-1",
      connectionId: "connection-failed-evidence",
      snapshotId: "snapshot-failed-evidence",
    });
    await prisma.repositoryScanJob.create({
      data: {
        id: "scan-failed-evidence",
        assessmentId: "assessment-failed-evidence",
        snapshotId: "snapshot-failed-evidence",
        idempotencyKey: "key-failed-evidence",
        correlationId: "corr-failed-evidence",
        triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
        status: REPOSITORY_SCAN_JOB_STATUSES.failed,
      },
    });

    const failed = await request("assessment-failed-evidence", customerToken);
    assert.equal(failed.status, 409);
    assert.equal(problemCode(failed), EVIDENCE_ERROR_CODES.buildFailed);
    assert.deepEqual(problemBody(failed).meta, {
      scanJobId: "scan-failed-evidence",
      scanStatus: REPOSITORY_SCAN_JOB_STATUSES.failed,
    });
  });

  it("does not reveal another customer's evidence build state", async () => {
    await seedRepositorySnapshotGraph(prisma, {
      assessmentId: "assessment-other-building",
      userId: "user-2",
      connectionId: "connection-other-building",
      snapshotId: "snapshot-other-building",
    });
    await prisma.repositoryScanJob.create({
      data: {
        id: "scan-other-building",
        assessmentId: "assessment-other-building",
        snapshotId: "snapshot-other-building",
        idempotencyKey: "key-other-building",
        correlationId: "corr-other-building",
        triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
        status: REPOSITORY_SCAN_JOB_STATUSES.running,
      },
    });

    const other = await request("assessment-other-building", customerToken);
    assert.equal(other.status, 404);
    assert.notEqual(problemCode(other), EVIDENCE_ERROR_CODES.notReady);
  });

  async function signIn(email: string, password: string): Promise<string> {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({ email, password, organization_id: "org-1" });
    return successBody<SignInSuccess>(result).session_token ?? "";
  }

  async function createAcceptedEvidence(
    assessmentId: string,
    userId: string,
  ): Promise<void> {
    await seedRepositorySnapshotGraph(prisma, {
      assessmentId,
      userId,
      connectionId: `connection-${assessmentId}`,
      snapshotId: `snapshot-${assessmentId}`,
    });
    await prisma.repositoryScanJob.create({
      data: {
        id: `scan-${assessmentId}`,
        assessmentId,
        snapshotId: `snapshot-${assessmentId}`,
        idempotencyKey: `key-${assessmentId}`,
        correlationId: `corr-${assessmentId}`,
        triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
        status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      },
    });
    await prisma.technicalEvidenceReport.create({
      data: {
        id: `report-${assessmentId}`,
        assessmentId,
        scanJobId: `scan-${assessmentId}`,
        snapshotId: `snapshot-${assessmentId}`,
        toolsVersion: { scanner: "1" },
        configHash: { scanner: "hash" },
        evidencePayload: {},
        privacyFlags: { containsSourceCode: false, secretsRedacted: true },
        schemaVersion: "1.0.0",
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      },
    });
  }

  function request(assessmentId: string, token: string) {
    return httpRequest(app)
      .get(`/assessments/${assessmentId}/evidence-graph`)
      .set("Authorization", `Bearer ${token}`);
  }
});
