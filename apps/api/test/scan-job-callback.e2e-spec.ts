/** MW-scan-002: Scan Job Callback Endpoint. */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  type RepositoryScanJobStatus,
} from "@lcsp/contracts/github-integration";
import {
  SCAN_CALLBACK_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
} from "@lcsp/contracts/scan";
import { OUTBOX_MESSAGE_SCHEMA_VERSION } from "@lcsp/contracts/outbox";

import { json } from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { AppModule } from "../src/app.module.js";
import type {
  ScanCallbackDto,
  ScanCallbackRequest,
} from "../src/modules/scan/application/contracts/scan/scan-callback.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedRepositorySnapshotGraph,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

describe("Scan Job Callback Endpoint (e2e) [MW-scan-002]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_KEY;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.match(/^\/internal\/scan-jobs\/[^/]+\/callback$/)) {
        (json({ limit: "50mb" }) as RequestHandler)(req, res, next);
      } else {
        (json({ limit: "1mb" }) as RequestHandler)(req, res, next);
      }
    });
    await app.init();
  });

  beforeEach(async () => {
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.repositoryScanJob.deleteMany();
    await prisma.outboxMessage.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.assessment.create({
      data: {
        id: "assessment-1",
        ownerId: "user-1",
        name: "Callback assessment",
        status: ASSESSMENT_STATUS_CODES.scanInProgress,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T08 accepts clean evidence and atomically completes the job", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);

    const response = await callback(app, validPayload());
    const body = successBody<ScanCallbackDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.ok(body.evidence_report_id);
    const [job, report, outbox, audit] = await Promise.all([
      prisma.repositoryScanJob.findUnique({ where: { id: "scan-job-1" } }),
      prisma.technicalEvidenceReport.findUnique({
        where: { scanJobId: "scan-job-1" },
      }),
      prisma.outboxMessage.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.evidenceAccepted },
      }),
      prisma.authAuditEvent.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.evidenceAcceptedAudit },
      }),
    ]);
    assert.equal(job?.status, REPOSITORY_SCAN_JOB_STATUSES.completed);
    assert.equal(report?.status, TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted);
    assert.equal(report?.schemaVersion, "1.0.0");
    assert.equal(outbox?.aggregateId, body.evidence_report_id);
    assert.equal(
      (outbox?.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(
      (outbox?.payload as { causationId?: string }).causationId,
      "scan-job-1",
    );
    assert.equal(audit?.resourceId, body.evidence_report_id);
    assert.equal(
      (audit?.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audit?.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
  });

  it("T02 rejects containsSourceCode=true", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    const response = await callback(
      app,
      validPayload({
        privacy_flags: { containsSourceCode: true, secretsRedacted: true },
      }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.privacyFlagsInvalid,
    );
    await assertNoMutation(prisma);
  });

  it("T03 rejects secretsRedacted=false", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    const response = await callback(
      app,
      validPayload({
        privacy_flags: { containsSourceCode: false, secretsRedacted: false },
      }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.privacyFlagsInvalid,
    );
    await assertNoMutation(prisma);
  });

  it("T04 rejects an unknown schema version", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    const response = await callback(
      app,
      validPayload({ schema_version: "99.0" }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.evidenceSchemaInvalid,
    );
    await assertNoMutation(prisma);
  });

  it("T05 rejects an invalid worker API key", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    const response = await httpRequest(app)
      .post("/internal/scan-jobs/scan-job-1/callback")
      .set("X-Worker-Api-Key", "invalid-worker-key")
      .send(validPayload());

    assert.equal(response.status, 401);
    await assertNoMutation(prisma);
  });

  it("T06 accepts a queued job and atomically completes it", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.queued);
    const response = await callback(app, validPayload());
    const job = await prisma.repositoryScanJob.findUnique({
      where: { id: "scan-job-1" },
    });

    assert.equal(response.status, 200);
    assert.equal(job?.status, REPOSITORY_SCAN_JOB_STATUSES.completed);
  });

  it("T07 persists rejected evidence and fails the job", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    const response = await callback(
      app,
      validPayload({
        status: SCAN_CALLBACK_STATUSES.failed,
        error_code: "SCANNER_EXECUTION_FAILED",
      }),
    );
    const body = successBody<ScanCallbackDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, false);
    const [job, report, outbox, audit] = await Promise.all([
      prisma.repositoryScanJob.findUnique({ where: { id: "scan-job-1" } }),
      prisma.technicalEvidenceReport.findUnique({
        where: { scanJobId: "scan-job-1" },
      }),
      prisma.outboxMessage.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.evidenceAccepted },
      }),
      prisma.authAuditEvent.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.evidenceRejectedAudit },
      }),
    ]);
    assert.equal(job?.status, REPOSITORY_SCAN_JOB_STATUSES.failed);
    assert.equal(report?.status, TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected);
    assert.equal(report?.rejectionReason, "SCANNER_EXECUTION_FAILED");
    assert.equal(outbox, null);
    assert.equal(audit?.resourceId, body.evidence_report_id);
  });

  it("T09 rejects raw source and secret patterns inside evidence", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    const response = await callback(
      app,
      validPayload({
        evidence_payload: {
          findings: [{ source_code: "const token = 'ghp_secret'" }],
        },
      }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.privacyFlagsInvalid,
    );
    await assertNoMutation(prisma);
  });

  it("T10 accepts large payload under 50MB (e.g. 2MB)", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    const largeStr = "a".repeat(2 * 1024 * 1024);
    const response = await callback(
      app,
      validPayload({
        evidence_payload: {
          findings: [{ finding_type: "AI_MODEL_INVOCATION" }],
          large_field: largeStr,
        },
      }),
    );
    assert.equal(response.status, 200);
    const body = successBody<ScanCallbackDto>(response);
    assert.equal(body.accepted, true);
  });

  it("T11 rejects oversized payload exceeding 50MB (e.g. 51MB)", async () => {
    await createJob(prisma, REPOSITORY_SCAN_JOB_STATUSES.running);
    const giantStr = "a".repeat(51 * 1024 * 1024);
    const response = await callback(
      app,
      validPayload({
        evidence_payload: {
          findings: [{ finding_type: "AI_MODEL_INVOCATION" }],
          large_field: giantStr,
        },
      }),
    );
    assert.equal(response.status, 413);
  });
});

function callback(app: INestApplication, payload: ScanCallbackRequest) {
  return httpRequest(app)
    .post("/internal/scan-jobs/scan-job-1/callback")
    .set("X-Worker-Api-Key", WORKER_KEY)
    .set("X-Correlation-Id", "callback-corr-1")
    .send(payload);
}

function validPayload(
  overrides: Partial<ScanCallbackRequest> = {},
): ScanCallbackRequest {
  return {
    scan_job_id: "scan-job-1",
    tools_version: { semgrep: "1.0.0", syft: "0.90.0" },
    config_hash: { semgrep: "sha256:abc", syft: "sha256:def" },
    evidence_payload: { findings: [{ finding_type: "AI_MODEL_INVOCATION" }] },
    privacy_flags: {
      containsSourceCode: false,
      secretsRedacted: true,
    },
    schema_version: "1.0.0",
    status: SCAN_CALLBACK_STATUSES.success,
    ...overrides,
  };
}

async function createJob(
  prisma: PrismaClient,
  status: RepositoryScanJobStatus,
) {
  await seedRepositorySnapshotGraph(prisma, { snapshotId: "snapshot-1" });
  await prisma.repositoryScanJob.create({
    data: {
      id: "scan-job-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      idempotencyKey: "scan-request:assessment-1:snapshot-1:callback",
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
      status,
      attemptCount: 1,
      correlationId: "job-corr-1",
    },
  });
}

async function assertNoMutation(prisma: PrismaClient): Promise<void> {
  const [job, reports, outbox] = await Promise.all([
    prisma.repositoryScanJob.findUnique({ where: { id: "scan-job-1" } }),
    prisma.technicalEvidenceReport.count(),
    prisma.outboxMessage.count({
      where: { eventType: SCAN_EVENT_TYPES.evidenceAccepted },
    }),
  ]);
  assert.equal(job?.status, REPOSITORY_SCAN_JOB_STATUSES.running);
  assert.equal(reports, 0);
  assert.equal(outbox, 0);
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
