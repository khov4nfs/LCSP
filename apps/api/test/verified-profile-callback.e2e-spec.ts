/** MW-rec-004: VerifiedProfile Callback Endpoint. */

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
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import {
  AI_USAGE_FLOW_STATUSES,
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  TECHNICAL_PROFILE_STATUSES,
  VERIFIED_PROFILE_SCHEMA_VERSIONS,
  VERIFIED_PROFILE_STATUSES,
  type ConflictRecordStatus,
} from "@lcsp/contracts/scan";

import { AppModule } from "../src/app.module.js";
import type {
  VerifiedProfileCallbackDto,
  VerifiedProfileCallbackRequest,
} from "../src/modules/reconciliation/application/contracts/reconciliation/verified-profile-callback.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

describe("VerifiedProfile Callback Endpoint (e2e) [MW-rec-004]", () => {
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
    await resetDomainData(prisma);
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await grantVerifiedProfileApproval(prisma);
    await seedAssessmentChain(prisma, "assessment-1", "org-1");
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it("T01/T04 stores pending profile without emitting downstream ready event and audits safe refs", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.resolved },
    ]);

    const response = await callback(app, validPayload());
    const body = successBody<VerifiedProfileCallbackDto>(response);

    assert.equal(response.status, 200);
    assert.equal(body.accepted, true);
    assert.equal(body.status, VERIFIED_PROFILE_STATUSES.pendingApproval);
    assert.ok(body.verified_profile_id);

    const [profile, outbox, audit] = await Promise.all([
      prisma.verifiedProfile.findUnique({
        where: { id: body.verified_profile_id },
      }),
      prisma.outboxMessage.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.verifiedProfileReady },
      }),
      prisma.authAuditEvent.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.verifiedProfileAcceptedAudit },
      }),
    ]);

    assert.equal(profile?.aiUsageFlowId, "ai-flow-1");
    assert.equal(profile?.assessmentId, "assessment-1");
    assert.equal(profile?.organizationId, "org-1");
    assert.deepEqual(profile?.profileData, validPayload().profile_data);
    assert.deepEqual(profile?.gatesPassedAt, validPayload().gates_passed_at);
    assert.equal(profile?.status, VERIFIED_PROFILE_STATUSES.pendingApproval);
    assert.equal(profile?.approvedAt, null);
    assert.equal(profile?.approvedById, null);
    assert.equal(outbox, null);
    assert.equal(audit?.resourceId, body.verified_profile_id);
    assert.equal(
      (audit?.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audit?.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
    assert.equal(
      (audit?.payload as { profileData?: unknown }).profileData,
      undefined,
    );
  });

  it("T01b emits verified-profile-ready only after Manager approval", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.resolved },
    ]);

    const generated = await callback(app, validPayload());
    const generatedBody = successBody<VerifiedProfileCallbackDto>(generated);
    const token = await signInManager(app);

    const approved = await httpRequest(app)
      .post(
        `/assessments/assessment-1/verified-profiles/${generatedBody.verified_profile_id}/approve`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});
    const approvedBody = successBody<{
      verified_profile_id: string;
      status: string;
      approved_at: string;
      approved_by_id: string;
    }>(approved);

    assert.equal(approved.status, 200);
    assert.equal(
      approvedBody.verified_profile_id,
      generatedBody.verified_profile_id,
    );
    assert.equal(approvedBody.status, VERIFIED_PROFILE_STATUSES.approved);
    assert.equal(approvedBody.approved_by_id, "user-1");
    assert.ok(approvedBody.approved_at);

    const [profile, outbox, audit] = await Promise.all([
      prisma.verifiedProfile.findUnique({
        where: { id: generatedBody.verified_profile_id },
      }),
      prisma.outboxMessage.findFirst({
        where: {
          eventType: SCAN_EVENT_TYPES.verifiedProfileReady,
          aggregateId: generatedBody.verified_profile_id,
        },
      }),
      prisma.authAuditEvent.findFirst({
        where: {
          eventType: SCAN_EVENT_TYPES.verifiedProfileApprovedAudit,
          resourceId: generatedBody.verified_profile_id,
        },
      }),
    ]);

    assert.equal(profile?.status, VERIFIED_PROFILE_STATUSES.approved);
    assert.equal(profile?.approvedById, "user-1");
    assert.ok(profile?.approvedAt);
    assert.equal(outbox?.aggregateId, generatedBody.verified_profile_id);
    assert.equal(
      (outbox?.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(
      (outbox?.payload as { status?: string }).status,
      VERIFIED_PROFILE_STATUSES.approved,
    );
    assert.equal(audit?.actorId, "user-1");
    assert.equal(audit?.policyId, "policy-manager-workspace");
    assert.equal(audit?.policyVersion, "2026-06-26");
  });

  it("T01c rejects duplicate Manager approval", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.resolved },
    ]);

    const generated = await callback(app, validPayload());
    const generatedBody = successBody<VerifiedProfileCallbackDto>(generated);
    const token = await signInManager(app);
    const path = `/assessments/assessment-1/verified-profiles/${generatedBody.verified_profile_id}/approve`;

    const first = await httpRequest(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(first.status, 200);

    const duplicate = await httpRequest(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assertError(
      duplicate.status,
      duplicate.body,
      409,
      SCAN_ERROR_CODES.verifiedProfileWrongState,
    );
    assert.equal(
      await prisma.outboxMessage.count({
        where: {
          eventType: SCAN_EVENT_TYPES.verifiedProfileReady,
          aggregateId: generatedBody.verified_profile_id,
        },
      }),
      1,
    );
  });

  it("T02 rejects unresolved pending conflicts", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.pending },
    ]);

    const response = await callback(app, validPayload());

    assertError(
      response.status,
      response.body,
      409,
      SCAN_ERROR_CODES.pendingConflictsExist,
    );
    await assertNoVerifiedProfileMutation(prisma);
  });

  it("T03 rejects duplicate profile for the same AIUsageFlow", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.resolved },
    ]);

    await callback(app, validPayload());
    const duplicate = await callback(app, validPayload());

    assertError(
      duplicate.status,
      duplicate.body,
      409,
      SCAN_ERROR_CODES.profileAlreadyExists,
    );
  });

  it("T05 rejects an invalid worker API key", async () => {
    const response = await httpRequest(app)
      .post("/internal/reconciliation/verified-profile-callback")
      .set("X-Worker-Api-Key", "invalid-worker-key")
      .send(validPayload());

    assert.equal(response.status, 401);
    await assertNoVerifiedProfileMutation(prisma);
  });

  it("returns the reconciliation context for the event AI usage flow", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.resolved },
    ]);
    await prisma.wizardProfile.deleteMany({
      where: { assessmentId: "assessment-1" },
    });
    await prisma.wizardProfile.create({
      data: {
        id: "reconciliation-context-wizard-1",
        assessmentId: "assessment-1",
        organizationId: "org-1",
        ownerId: "user-1",
        answers: { aiPurpose: "decision_support" },
      },
    });

    const response = await httpRequest(app)
      .get(
        "/internal/reconciliation/verified-profile-context/assessment-1?ai_usage_flow_id=ai-flow-1",
      )
      .set("X-Worker-Api-Key", WORKER_KEY);
    const body = successBody<{
      ai_usage_flow: { id: string; claims: unknown };
      conflicts: Array<{ conflict_id: string; status: string }>;
      wizard_profile: { id: string; answers: unknown } | null;
    }>(response);

    assert.equal(response.status, 200);
    assert.equal(body.ai_usage_flow.id, "ai-flow-1");
    assert.deepEqual(body.ai_usage_flow.claims, [{ claim_id: "claim-1" }]);
    assert.equal(body.conflicts.length, 1);
    assert.equal(body.conflicts[0]?.conflict_id, "conflict-1");
    assert.equal(body.conflicts[0]?.status, CONFLICT_RECORD_STATUSES.resolved);
    assert.deepEqual(body.wizard_profile, {
      id: "reconciliation-context-wizard-1",
      assessment_id: "assessment-1",
      version: 1,
      answers: { aiPurpose: "decision_support" },
    });
  });

  it("T06 rejects mutation attempts after acceptance because no update path exists", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.dismissed },
    ]);

    await callback(app, validPayload());

    const updateAttempt = await httpRequest(app)
      .patch("/internal/reconciliation/verified-profile-callback")
      .set("X-Worker-Api-Key", WORKER_KEY)
      .send(validPayload({ profile_data: { verified_claims: [] } }));

    assert.equal(updateAttempt.status, 404);
    assert.equal(await prisma.verifiedProfile.count(), 1);
  });

  it("rejects missing AIUsageFlow and invalid schema version", async () => {
    const missingFlow = await callback(
      app,
      validPayload({ ai_usage_flow_id: "missing-flow" }),
    );
    assertError(
      missingFlow.status,
      missingFlow.body,
      404,
      SCAN_ERROR_CODES.aiUsageFlowNotFound,
    );

    const invalidSchema = await callback(
      app,
      validPayload({ schema_version: "0.0.0" }),
    );
    assertError(
      invalidSchema.status,
      invalidSchema.body,
      422,
      SCAN_ERROR_CODES.verifiedProfileSchemaInvalid,
    );
    await assertNoVerifiedProfileMutation(prisma);
  });
});

function callback(
  app: INestApplication,
  payload: VerifiedProfileCallbackRequest,
) {
  return httpRequest(app)
    .post("/internal/reconciliation/verified-profile-callback")
    .set("X-Worker-Api-Key", WORKER_KEY)
    .set("X-Correlation-Id", "verified-profile-corr-1")
    .send(payload);
}

function validPayload(
  overrides: Partial<VerifiedProfileCallbackRequest> = {},
): VerifiedProfileCallbackRequest {
  return {
    ai_usage_flow_id: "ai-flow-1",
    assessment_id: "assessment-1",
    schema_version: VERIFIED_PROFILE_SCHEMA_VERSIONS[0],
    provider_version: "verified-profile-worker@1.0.0",
    profile_data: {
      verified_claims: [
        {
          claim_id: "claim-1",
          claim_category: "MODEL_INVOCATION",
          evidence_refs: ["evidence-assessment-1::finding-1"],
        },
      ],
      evidence_chain_integrity: true,
    },
    gates_passed_at: {
      conflicts_resolved: "2026-07-25T09:30:00.000Z",
    },
    ...overrides,
  };
}

async function resetDomainData(prisma: PrismaClient): Promise<void> {
  await prisma.verifiedProfile.deleteMany();
  await prisma.conflictRecord.deleteMany();
  await prisma.aIUsageFlow.deleteMany();
  await prisma.technicalProfile.deleteMany();
  await prisma.technicalEvidenceReport.deleteMany();
  await prisma.repositoryScanJob.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.assessment.deleteMany();
}

async function seedAssessmentChain(
  prisma: PrismaClient,
  assessmentId: string,
  organizationId: string,
): Promise<void> {
  await prisma.assessment.create({
    data: {
      id: assessmentId,
      organizationId,
      ownerId: "user-1",
      name: `Assessment ${assessmentId}`,
      status: ASSESSMENT_STATUS_CODES.scanInProgress,
    },
  });
  await prisma.technicalEvidenceReport.create({
    data: {
      id: `evidence-${assessmentId}`,
      scanJobId: `scan-job-${assessmentId}`,
      assessmentId,
      snapshotId: `snapshot-${assessmentId}`,
      organizationId,
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
      organizationId,
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
      technicalProfileId: `technical-profile-${assessmentId}`,
      assessmentId,
      organizationId,
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
  conflicts: Array<{ id: string; status: ConflictRecordStatus }>,
): Promise<void> {
  await prisma.conflictRecord.createMany({
    data: conflicts.map((conflict, index) => ({
      id: conflict.id,
      aiUsageFlowId: "ai-flow-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      conflictType: index === 0 ? "evidence_contradiction" : "scope_mismatch",
      conflictScore: index === 0 ? 0.88 : 0.42,
      scoreExplanation: "Manager and technical evidence differ.",
      evidenceRefs: [`evidence-assessment-1::finding-${index + 1}`],
      status: conflict.status,
      ...(conflict.status === CONFLICT_RECORD_STATUSES.pending
        ? {}
        : { resolvedAt: new Date(), resolvedById: "user-1" }),
    })),
  });
}

async function grantVerifiedProfileApproval(
  prisma: PrismaClient,
): Promise<void> {
  const policy = await prisma.authPolicy.findUniqueOrThrow({
    where: {
      id_version: {
        id: "policy-manager-workspace",
        version: "2026-06-26",
      },
    },
  });
  await prisma.authPolicy.update({
    where: { id_version: { id: policy.id, version: policy.version } },
    data: {
      actions: [
        ...new Set([...policy.actions, PBAC_ACTIONS.verifiedProfileApprove]),
      ],
    },
  });
}

async function signInManager(app: INestApplication): Promise<string> {
  const response = await httpRequest(app).post("/auth/sign-in").send({
    email: "manager@acme.test",
    password: "CorrectHorseBatteryStaple!",
    organization_id: "org-1",
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return successBody<{ session_token: string }>(response).session_token;
}

async function assertNoVerifiedProfileMutation(
  prisma: PrismaClient,
): Promise<void> {
  const [profiles, outbox] = await Promise.all([
    prisma.verifiedProfile.count(),
    prisma.outboxMessage.count({
      where: { eventType: SCAN_EVENT_TYPES.verifiedProfileReady },
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
