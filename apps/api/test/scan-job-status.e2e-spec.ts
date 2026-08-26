/** MW-scan-001: Scan Job Status Endpoint. */

import * as assert from "node:assert/strict";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  type RepositoryScanJobStatus,
} from "@lcsp/contracts/github-integration";
import { SCAN_ERROR_CODES, SCAN_JOB_GUIDANCE } from "@lcsp/contracts/scan";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import type { ScanJobStatusDto } from "../src/modules/scan/application/contracts/scan/scan-job-status.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedRepositoryScanGraph,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

describe("Scan Job Status Endpoint (e2e) [MW-scan-001]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_KEY;
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
    await prisma.repositoryScanJob.deleteMany();
    await prisma.repositorySnapshot.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.assessment.create({
      data: {
        id: "assessment-1",
        ownerId: "user-1",
        name: "Scan assessment",
        status: ASSESSMENT_STATUS_CODES.scanInProgress,
      },
    });

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: "org-1",
    });
    managerToken = successBody<SignInSuccess>(signIn).session_token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T06 returns a safe queued status projection", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.queued);

    const response = await getStatus(app, managerToken);
    const body = successBody<ScanJobStatusDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.scan_job_id, "scan-job-1");
    assert.equal(body.status, REPOSITORY_SCAN_JOB_STATUSES.queued);
    assert.equal(body.next_action, SCAN_JOB_GUIDANCE.queuedNextAction);
    assert.deepEqual(Object.keys(body).sort(), [
      "assessment_id",
      "attempt_count",
      "blocked_reason",
      "correlationId",
      "created_at",
      "next_action",
      "scan_job_id",
      "status",
      "trigger_source",
      "updated_at",
    ]);
  });

  it("T02 returns completed status with no next action", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.completed);

    const response = await getStatus(app, managerToken);
    const body = successBody<ScanJobStatusDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.status, REPOSITORY_SCAN_JOB_STATUSES.completed);
    assert.equal(body.next_action, null);
    assert.equal(body.blocked_reason, null);
  });

  it("T03 redacts a technical blocked reason", async () => {
    await createJob(
      prisma,
      REPOSITORY_SCAN_JOB_STATUSES.blocked,
      "Exception at /private/repository/service.ts:42 with stack trace",
    );

    const response = await getStatus(app, managerToken);
    const body = successBody<ScanJobStatusDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.blocked_reason, SCAN_JOB_GUIDANCE.blockedReason);
    assert.equal(body.next_action, SCAN_JOB_GUIDANCE.blockedNextAction);
    assert.doesNotMatch(JSON.stringify(body), /private|service\.ts|stack/i);
  });

  it("returns safe guidance for the pending-mapping pre-scan state", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.pendingMapping);

    const response = await getStatus(app, managerToken);
    const body = successBody<ScanJobStatusDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.status, REPOSITORY_SCAN_JOB_STATUSES.pendingMapping);
    assert.equal(body.blocked_reason, SCAN_JOB_GUIDANCE.pendingMappingReason);
    assert.equal(body.next_action, SCAN_JOB_GUIDANCE.pendingMappingNextAction);
  });

  it("T04 hides a job for a different assessment", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.queued, null, {
      assessmentId: "assessment-other",
    });

    const response = await getStatus(app, managerToken);

    assert.equal(response.status, 404);
    assert.equal(problemCode(response), SCAN_ERROR_CODES.jobNotFound);
  });

  it("allows a non-Manager with scan:read policy to read the requested scan job", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    await seedSystemAdmin(prisma);
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "system-admin@acme.test",
      password: "SystemAdminPass123!",
      organization_id: "org-1",
    });
    const token = successBody<SignInSuccess>(signIn).session_token;

    const allowed = await getStatus(app, token);
    assert.equal(allowed.status, 200);
  });
});

function getStatus(app: INestApplication, token: string) {
  return httpRequest(app)
    .get("/assessments/assessment-1/scan-jobs/scan-job-1")
    .set("Authorization", `Bearer ${token}`);
}

async function createJob(
  prisma: PrismaClient,
  status: RepositoryScanJobStatus,
  blockedReason: string | null = null,
  overrides: { assessmentId?: string } = {},
) {
  await seedRepositoryScanGraph(prisma, {
    assessmentId: overrides.assessmentId ?? "assessment-1",
    userId: "user-1",
    connectionId: "connection-1",
    snapshotId: "snapshot-1",
    scanJobId: "scan-job-1",
    scanJobStatus: status,
  });
  await prisma.repositoryScanJob.update({
    where: { id: "scan-job-1" },
    data: {
      blockedReason,
      attemptCount: 1,
      correlationId: "job-corr-1",
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
    },
  });
}

async function seedSystemAdmin(prisma: PrismaClient) {
  await prisma.authUser.create({
    data: {
      id: "system-admin-1",
      email: "system-admin@acme.test",
      passwordHash: hashSecret("SystemAdminPass123!"),
      emailVerified: true,
      failedLoginCount: 0,
      role: AUTH_USER_ROLES.admin,
    },
  });
}
