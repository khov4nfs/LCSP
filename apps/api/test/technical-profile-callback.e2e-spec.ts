/** MW-evid-002: TechnicalProfile Callback Endpoint. */

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
import { OUTBOX_MESSAGE_SCHEMA_VERSION } from "@lcsp/contracts/outbox";
import {
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  TECHNICAL_PROFILE_STATUSES,
  type TechnicalEvidenceReportStatus,
} from "@lcsp/contracts/scan";

import { AppModule } from "../src/app.module.js";
import type {
  TechnicalProfileCallbackDto,
  TechnicalProfileCallbackRequest,
} from "../src/modules/evidence/application/contracts/evidence/technical-profile-callback.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedRepositoryScanGraph,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

describe("TechnicalProfile Callback Endpoint (e2e) [MW-evid-002]", () => {
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
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await prisma.technicalProfile.deleteMany();
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
        name: "Technical profile callback assessment",
        status: ASSESSMENT_STATUS_CODES.scanInProgress,
      },
    });
    await seedRepositoryScanGraph(prisma, { scanJobId: "scan-job-1" });
    await createEvidenceReport(
      prisma,
      TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T06 accepts a valid profile, emits outbox, and audits safe refs", async () => {
    const response = await callback(app, validPayload());
    const body = successBody<TechnicalProfileCallbackDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.ok(body.technical_profile_id);

    const [profile, outbox, audit] = await Promise.all([
      prisma.technicalProfile.findUnique({
        where: { id: body.technical_profile_id },
      }),
      prisma.outboxMessage.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.technicalProfileReady },
      }),
      prisma.authAuditEvent.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.technicalProfileAcceptedAudit },
      }),
    ]);

    assert.equal(profile?.evidenceReportId, "evidence-report-1");
    assert.equal(profile?.status, TECHNICAL_PROFILE_STATUSES.accepted);
    assert.deepEqual(profile?.profileData, validPayload().profile_data);
    assert.equal(outbox?.aggregateId, body.technical_profile_id);
    assert.equal(
      (outbox?.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(
      (outbox?.payload as { causationId?: string }).causationId,
      "evidence-report-1",
    );
    assert.equal(audit?.resourceId, body.technical_profile_id);
    assert.equal(
      (audit?.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audit?.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
    assert.equal(
      (audit?.payload as { profile_data?: unknown }).profile_data,
      undefined,
    );
  });

  it("T02 rejects containsSourceCode=true", async () => {
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
    await assertNoProfileMutation(prisma);
  });

  it("T02 rejects unsafe source or secret material inside profile data", async () => {
    const response = await callback(
      app,
      validPayload({
        profile_data: {
          findings: [
            { source_code: "const token = 'ghp_secret12345678901234567890'" },
          ],
        },
      }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.privacyFlagsInvalid,
    );
    await assertNoProfileMutation(prisma);
  });

  it("T03 rejects an existing profile for the same evidence report", async () => {
    await callback(app, validPayload());
    const response = await callback(app, validPayload());

    assertError(
      response.status,
      response.body,
      409,
      SCAN_ERROR_CODES.profileAlreadyExists,
    );
  });

  it("T04 rejects an unknown evidence report", async () => {
    const response = await callback(
      app,
      validPayload({ evidence_report_id: "missing-report" }),
    );

    assertError(
      response.status,
      response.body,
      404,
      SCAN_ERROR_CODES.evidenceReportNotFound,
    );
    await assertNoProfileMutation(prisma);
  });

  it("T05 rejects an invalid worker API key", async () => {
    const response = await httpRequest(app)
      .post("/internal/evidence/technical-profile-callback")
      .set("X-Worker-Api-Key", "invalid-worker-key")
      .send(validPayload());

    assert.equal(response.status, 401);
    await assertNoProfileMutation(prisma);
  });

  it("T08 accepts schema v2 profiles from the technical profile worker", async () => {
    const response = await callback(
      app,
      validPayload({ schema_version: "2.0.0" }),
    );
    const body = successBody<TechnicalProfileCallbackDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
  });

  it("T09 accepts inline fallback profile data when artifact chunks are unavailable", async () => {
    const response = await callback(
      app,
      validPayload({
        is_artifact_reference: true,
        artifact_manifest: {
          artifact_id: "missing-artifact",
          total_size: 123,
          hash: "sha256:missing",
          chunks: ["missing-artifact_chunk_0.json"],
        },
      }),
    );
    const body = successBody<TechnicalProfileCallbackDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
  });

  it("T07 rejects invalid schema and does not expose an update path", async () => {
    const invalidSchema = await callback(
      app,
      validPayload({ schema_version: "99.0" }),
    );

    assertError(
      invalidSchema.status,
      invalidSchema.body,
      422,
      SCAN_ERROR_CODES.technicalProfileSchemaInvalid,
    );
    await assertNoProfileMutation(prisma);

    const updateAttempt = await httpRequest(app)
      .patch("/internal/evidence/technical-profile-callback")
      .set("X-Worker-Api-Key", WORKER_KEY)
      .send(validPayload());
    assert.equal(updateAttempt.status, 404);
  });
});

function callback(
  app: INestApplication,
  payload: TechnicalProfileCallbackRequest,
) {
  return httpRequest(app)
    .post("/internal/evidence/technical-profile-callback")
    .set("X-Worker-Api-Key", WORKER_KEY)
    .set("X-Correlation-Id", "technical-profile-corr-1")
    .send(payload);
}

function validPayload(
  overrides: Partial<TechnicalProfileCallbackRequest> = {},
): TechnicalProfileCallbackRequest {
  return {
    evidence_report_id: "evidence-report-1",
    assessment_id: "assessment-1",
    schema_version: "1.0.0",
    provider_version: "technical-profile-worker@1.0.0",
    profile_data: {
      aiDetected: "confirmed",
      providers: ["openai"],
      frameworks: ["langchain"],
      modelInvocationCount: { min: 1, max: 3 },
      evidenceRefs: ["finding-1"],
      confidence: "high",
    },
    privacy_flags: {
      containsSourceCode: false,
      secretsRedacted: true,
    },
    ...overrides,
  };
}

async function createEvidenceReport(
  prisma: PrismaClient,
  status: TechnicalEvidenceReportStatus,
): Promise<void> {
  await prisma.technicalEvidenceReport.create({
    data: {
      id: "evidence-report-1",
      scanJobId: "scan-job-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      toolsVersion: { semgrep: "1.0.0" },
      configHash: { semgrep: "sha256:abc" },
      evidencePayload: { findings: [{ finding_type: "AI_MODEL_INVOCATION" }] },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      schemaVersion: "1.0.0",
      status,
    },
  });
}

async function assertNoProfileMutation(prisma: PrismaClient): Promise<void> {
  const [profiles, outbox] = await Promise.all([
    prisma.technicalProfile.count(),
    prisma.outboxMessage.count({
      where: { eventType: SCAN_EVENT_TYPES.technicalProfileReady },
    }),
  ]);
  assert.equal(profiles, 0);
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
