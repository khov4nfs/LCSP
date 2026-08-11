/** MW-rec-001: Conflict Detection Callback Endpoint. */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { OUTBOX_MESSAGE_SCHEMA_VERSION } from "@lcsp/contracts/outbox";
import {
  AI_USAGE_FLOW_STATUSES,
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  TECHNICAL_PROFILE_STATUSES,
  type AIUsageFlowStatus,
} from "@lcsp/contracts/scan";

import { AppModule } from "../src/app.module.js";
import type {
  ConflictDetectionCallbackDto,
  ConflictDetectionCallbackRequest,
} from "../src/modules/reconciliation/application/contracts/reconciliation/conflict-detection-callback.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

describe("Conflict Detection Callback Endpoint (e2e) [MW-rec-001]", () => {
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
    await prisma.conflictRecord.deleteMany();
    await prisma.aIUsageFlow.deleteMany();
    await prisma.technicalProfile.deleteMany();
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.outboxMessage.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.assessment.create({
      data: {
        id: "assessment-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Conflict callback assessment",
        status: ASSESSMENT_STATUS_CODES.scanInProgress,
      },
    });
    await createAIUsageFlow(prisma, AI_USAGE_FLOW_STATUSES.accepted);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T07 accepts valid conflicts, creates pending records, emits event, and audits each conflict", async () => {
    const response = await callback(app, validPayload());
    const body = successBody<ConflictDetectionCallbackDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(body.conflict_count, 2);

    const [records, outbox, audits] = await Promise.all([
      prisma.conflictRecord.findMany({ orderBy: { conflictType: "asc" } }),
      prisma.outboxMessage.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.reconciliationConflictsDetected },
      }),
      prisma.authAuditEvent.findMany({
        where: { eventType: SCAN_EVENT_TYPES.conflictDetectedAudit },
      }),
    ]);

    assert.equal(records.length, 2);
    assert.ok(records.every((record) => record.aiUsageFlowId === "ai-flow-1"));
    assert.ok(
      records.every(
        (record) => record.status === CONFLICT_RECORD_STATUSES.pending,
      ),
    );
    assert.deepEqual(records[0]?.evidenceRefs, [
      "evidence-report-1::finding-1",
    ]);
    assert.equal(outbox?.aggregateId, "ai-flow-1");
    assert.equal(
      (outbox?.payload as { conflictCount?: number }).conflictCount,
      2,
    );
    assert.equal(
      (outbox?.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(audits.length, 2);
    assert.ok(
      audits.every(
        (audit) => audit.resourceType === AUDIT_RESOURCE_TYPES.conflictRecord,
      ),
    );
    assert.equal(
      (audits[0]?.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audits[0]?.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
  });

  it("T02 accepts empty conflicts and emits all-conflicts-resolved event", async () => {
    const response = await callback(app, validPayload({ conflicts: [] }));
    const body = successBody<ConflictDetectionCallbackDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(body.conflict_count, 0);

    const [records, outbox, audit] = await Promise.all([
      prisma.conflictRecord.count(),
      prisma.outboxMessage.findFirst({
        where: {
          eventType: SCAN_EVENT_TYPES.reconciliationAllConflictsResolved,
        },
      }),
      prisma.authAuditEvent.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.noConflictsDetectedAudit },
      }),
    ]);
    assert.equal(records, 0);
    assert.equal(outbox?.aggregateId, "ai-flow-1");
    assert.equal(audit?.resourceId, "ai-flow-1");
  });

  it("T03 rejects conflict score outside the 0.0 to 1.0 range", async () => {
    const response = await callback(
      app,
      validPayload({
        conflicts: [{ ...validConflict(), conflict_score: 1.1 }],
      }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.conflictScoreInvalid,
    );
    await assertNoConflictMutation(prisma);
  });

  it("T04 rejects conflicts without evidence refs", async () => {
    const response = await callback(
      app,
      validPayload({
        conflicts: [{ ...validConflict(), evidence_refs: [] }],
      }),
    );

    assertError(
      response.status,
      response.body,
      422,
      SCAN_ERROR_CODES.evidenceRefsEmpty,
    );
    await assertNoConflictMutation(prisma);
  });

  it("T05 rejects an invalid worker API key", async () => {
    const response = await httpRequest(app)
      .post("/internal/reconciliation/conflict-callback")
      .set("X-Worker-Api-Key", "invalid-worker-key")
      .send(validPayload());

    assert.equal(response.status, 401);
    await assertNoConflictMutation(prisma);
  });

  it("T06 rejects a missing AIUsageFlow", async () => {
    const response = await callback(
      app,
      validPayload({ ai_usage_flow_id: "missing-flow" }),
    );

    assertError(
      response.status,
      response.body,
      404,
      SCAN_ERROR_CODES.aiUsageFlowNotFound,
    );
    await assertNoConflictMutation(prisma);
  });
});

function callback(
  app: INestApplication,
  payload: ConflictDetectionCallbackRequest,
) {
  return httpRequest(app)
    .post("/internal/reconciliation/conflict-callback")
    .set("X-Worker-Api-Key", WORKER_KEY)
    .set("X-Correlation-Id", "conflict-corr-1")
    .send(payload);
}

function validPayload(
  overrides: Partial<ConflictDetectionCallbackRequest> = {},
): ConflictDetectionCallbackRequest {
  return {
    ai_usage_flow_id: "ai-flow-1",
    assessment_id: "assessment-1",
    schema_version: "1.0.0",
    provider_version: "conflict-detection-worker@1.0.0",
    conflicts: [
      validConflict(),
      validConflict({
        conflict_type: "scope_mismatch",
        conflict_score: 0.42,
        evidence_refs: ["evidence-report-1::finding-2"],
      }),
    ],
    privacy_flags: {
      containsSourceCode: false,
      secretsRedacted: true,
    },
    ...overrides,
  };
}

function validConflict(
  overrides: Partial<
    ConflictDetectionCallbackRequest["conflicts"][number]
  > = {},
): ConflictDetectionCallbackRequest["conflicts"][number] {
  return {
    conflict_type: "evidence_contradiction",
    conflict_score: 0.88,
    score_explanation:
      "Manager answer and technical evidence describe different AI usage.",
    evidence_refs: ["evidence-report-1::finding-1"],
    ...overrides,
  };
}

async function createAIUsageFlow(
  prisma: PrismaClient,
  status: AIUsageFlowStatus,
): Promise<void> {
  await prisma.technicalEvidenceReport.create({
    data: {
      id: "evidence-report-1",
      scanJobId: "scan-job-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      organizationId: "org-1",
      toolsVersion: { semgrep: "1.0.0" },
      configHash: { semgrep: "sha256:abc" },
      evidencePayload: { findings: [{ finding_id: "finding-1" }] },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      schemaVersion: "1.0.0",
      status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
    },
  });
  await prisma.technicalProfile.create({
    data: {
      id: "technical-profile-1",
      evidenceReportId: "evidence-report-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      schemaVersion: "1.0.0",
      providerVersion: "technical-profile-worker@1.0.0",
      profileData: { aiDetected: "confirmed" },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: TECHNICAL_PROFILE_STATUSES.accepted,
    },
  });
  await prisma.aIUsageFlow.create({
    data: {
      id: "ai-flow-1",
      technicalProfileId: "technical-profile-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      schemaVersion: "1.0.0",
      providerVersion: "ai-usage-flow-worker@1.0.0",
      claims: [{ claim_id: "claim-1" }],
      unknownUsages: [],
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status,
    },
  });
}

async function assertNoConflictMutation(prisma: PrismaClient): Promise<void> {
  const [records, outbox] = await Promise.all([
    prisma.conflictRecord.count(),
    prisma.outboxMessage.count({
      where: {
        eventType: {
          in: [
            SCAN_EVENT_TYPES.reconciliationConflictsDetected,
            SCAN_EVENT_TYPES.reconciliationAllConflictsResolved,
          ],
        },
      },
    }),
  ]);
  assert.equal(records, 0);
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
