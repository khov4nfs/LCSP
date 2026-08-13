import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { OUTBOX_MESSAGE_SCHEMA_VERSION } from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS, PBAC_REASON_CODE } from "@lcsp/contracts/pbac";
/** MW-gh-004: Scan Trigger Endpoint. */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import type { TriggerScanDto } from "../src/modules/github-integration/application/contracts/github-integration/trigger-scan.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";
const IDEMPOTENCY_KEY = "scan-request:assessment-1:snapshot-1:1";

describe("Scan Trigger Endpoint (e2e) [MW-gh-004]", () => {
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
    await prisma.outboxMessage.deleteMany({
      where: { eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered },
    });
    await prisma.repositoryScanJob.deleteMany();
    await prisma.repositorySnapshot.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.assessment.create({
      data: {
        id: "assessment-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Scan assessment",
        status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
      },
    });
    await createSnapshot(prisma, "snapshot-1");

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

  it("T01/T06: creates a durable queued job, outbox command, and audit", async () => {
    const response = await triggerManual(app, managerToken);
    const body = successBody<TriggerScanDto>(response);

    assert.equal(response.status, 201);
    assert.equal(body.status, REPOSITORY_SCAN_JOB_STATUSES.queued);
    assert.equal(body.is_new, true);

    const job = await prisma.repositoryScanJob.findUnique({
      where: { id: body.scan_job_id },
    });
    assert.ok(job);
    assert.equal(job.snapshotId, "snapshot-1");
    assert.equal(job.attemptCount, 0);
    const event = await prisma.outboxMessage.findFirst({
      where: {
        aggregateId: body.scan_job_id,
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered,
      },
    });
    assert.ok(event);
    assert.equal(
      (event.payload as { snapshotId?: string }).snapshotId,
      "snapshot-1",
    );
    assert.equal(
      (event.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(
      (event.payload as { causationId?: string }).causationId,
      body.correlationId,
    );
    const audit = await prisma.authAuditEvent.findFirst({
      where: {
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanJobTriggeredAudit,
        resourceId: body.scan_job_id,
      },
    });
    assert.ok(audit);
    assert.equal(
      (audit.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audit.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
  });

  it("T02: duplicate delivery returns the existing job with no new outbox", async () => {
    const first = await triggerManual(app, managerToken);
    const firstBody = successBody<TriggerScanDto>(first);
    await prisma.assessment.update({
      where: { id: "assessment-1" },
      data: { status: ASSESSMENT_STATUS_CODES.scanInProgress },
    });
    const second = await triggerManual(app, managerToken);
    const secondBody = successBody<TriggerScanDto>(second);

    assert.equal(second.status, 200);
    assert.equal(secondBody.is_new, false);
    assert.equal(secondBody.scan_job_id, firstBody.scan_job_id);
    assert.equal(await prisma.repositoryScanJob.count(), 1);
    assert.equal(
      await prisma.outboxMessage.count({
        where: { eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered },
      }),
      1,
    );
  });

  it("T03: rejects an assessment state that cannot start scan", async () => {
    await prisma.assessment.update({
      where: { id: "assessment-1" },
      data: { status: ASSESSMENT_STATUS_CODES.wizardInProgress },
    });

    const response = await triggerManual(app, managerToken);

    assert.equal(response.status, 409);
    assert.equal(
      problemCode(response),
      GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
    );
    assert.equal(await prisma.repositoryScanJob.count(), 0);
  });

  it("rejects an idempotency key reused for a different snapshot", async () => {
    await triggerManual(app, managerToken);
    await createSnapshot(prisma, "snapshot-2");

    const response = await httpRequest(app)
      .post("/assessments/assessment-1/scan-jobs")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        snapshot_id: "snapshot-2",
        trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
        idempotency_key: IDEMPOTENCY_KEY,
      });

    assert.equal(response.status, 409);
    assert.equal(
      problemCode(response),
      GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyConflict,
    );
    assert.equal(await prisma.repositoryScanJob.count(), 1);
  });

  it("T04: hides a snapshot outside the session organization", async () => {
    await prisma.repositorySnapshot.update({
      where: { id: "snapshot-1" },
      data: { organizationId: "org-other" },
    });

    const response = await triggerManual(app, managerToken);

    assert.equal(response.status, 404);
    assert.equal(
      problemCode(response),
      GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
    );
  });

  it("T05: PBAC denies a Manager without scan:trigger", async () => {
    await prisma.authPolicy.update({
      where: {
        id_version: {
          id: "policy-manager-workspace",
          version: "2026-06-26",
        },
      },
      data: { actions: [PBAC_ACTIONS.workspaceRead] },
    });

    const response = await triggerManual(app, managerToken);

    assert.equal(response.status, 403);
    assert.equal(problemCode(response), PBAC_REASON_CODE.denied);
    assert.equal(await prisma.repositoryScanJob.count(), 0);
  });

  it("accepts a trusted trigger with the worker API key and no user session", async () => {
    const response = await httpRequest(app)
      .post("/assessments/assessment-1/scan-jobs")
      .set("X-Worker-Api-Key", WORKER_KEY)
      .send({
        snapshot_id: "snapshot-1",
        trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
        idempotency_key: "trusted-trigger:github:delivery-1",
      });

    assert.equal(response.status, 201);
    assert.equal(successBody<TriggerScanDto>(response).is_new, true);
    assert.equal(
      (
        await prisma.repositoryScanJob.findUniqueOrThrow({
          where: { id: successBody<TriggerScanDto>(response).scan_job_id },
        })
      ).triggerSource,
      REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
    );
  });

  it("rejects incomplete mapping without enqueueing a scan", async () => {
    await prisma.repositorySnapshot.update({
      where: { id: "snapshot-1" },
      data: { repositoryId: "" },
    });

    const response = await triggerManual(app, managerToken);
    const body = successBody<TriggerScanDto>(response);

    assert.equal(response.status, 201);
    assert.equal(body.status, REPOSITORY_SCAN_JOB_STATUSES.pendingMapping);
    const job = await prisma.repositoryScanJob.findUniqueOrThrow({
      where: { id: body.scan_job_id },
    });
    assert.equal(job.status, REPOSITORY_SCAN_JOB_STATUSES.pendingMapping);
    assert.equal(
      job.blockedReason,
      GITHUB_INTEGRATION_ERROR_CODES.scanBlockedMapping,
    );
    assert.equal(
      await prisma.outboxMessage.count({
        where: { eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered },
      }),
      0,
    );
  });

  it("T07: rerun creates a new chain without mutating a terminal prior job", async () => {
    const priorUpdatedAt = new Date("2026-07-17T00:00:00.000Z");
    await prisma.repositoryScanJob.create({
      data: {
        id: "prior-scan-job",
        assessmentId: "assessment-1",
        snapshotId: "snapshot-1",
        organizationId: "org-1",
        idempotencyKey: "scan-request:assessment-1:snapshot-1:0",
        triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
        status: REPOSITORY_SCAN_JOB_STATUSES.completed,
        attemptCount: 1,
        correlationId: "prior-corr",
        createdAt: priorUpdatedAt,
        updatedAt: priorUpdatedAt,
      },
    });

    const response = await triggerManual(app, managerToken);

    assert.equal(response.status, 201);
    assert.equal(await prisma.repositoryScanJob.count(), 2);
    const prior = await prisma.repositoryScanJob.findUniqueOrThrow({
      where: { id: "prior-scan-job" },
    });
    assert.equal(prior.status, REPOSITORY_SCAN_JOB_STATUSES.completed);
    assert.equal(prior.correlationId, "prior-corr");
    assert.equal(prior.updatedAt.toISOString(), priorUpdatedAt.toISOString());
  });
});

function triggerManual(app: INestApplication, token: string) {
  return httpRequest(app)
    .post("/assessments/assessment-1/scan-jobs")
    .set("Authorization", `Bearer ${token}`)
    .send({
      snapshot_id: "snapshot-1",
      trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
      idempotency_key: IDEMPOTENCY_KEY,
    });
}

async function createSnapshot(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.repositorySnapshot.create({
    data: {
      id,
      assessmentId: "assessment-1",
      organizationId: "org-1",
      connectionId: "connection-1",
      repositoryId: "repo-1",
      repositoryFullName: "acme/example-repo",
      branch: "main",
      commitSha: "a".repeat(40),
      providerMetadata: { requestedRevision: "main" },
      actorId: "user-1",
      status: REPOSITORY_SNAPSHOT_STATUSES.ready,
    },
  });
}
