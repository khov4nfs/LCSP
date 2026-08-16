/** MW-rec-004: VerifiedProfile Callback Endpoint. */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { LegalRetrievalIndexStatus, PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  LEGAL_MATCHING_REQUEST_COMMAND,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import { OUTBOX_MESSAGE_SCHEMA_VERSION } from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import {
  AI_USAGE_FLOW_STATUSES,
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  TECHNICAL_PROFILE_STATUSES,
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
const ASSESSMENT_ID = "assessment-1";
const ORGANIZATION_ID = "org-1";
const AI_USAGE_FLOW_ID = "ai-flow-1";
const WIZARD_PROFILE_ID = "wizard-assessment-1";
const TECHNICAL_EVIDENCE_REPORT_ID = "evidence-assessment-1";
const DEFAULT_IDEMPOTENCY_KEY = "verified-profile-idempotency-1";
const EVIDENCE_REF = "evidence-assessment-1::finding-1";

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
    await seedReadyLegalMatchingTarget(prisma);
    await seedAssessmentChain(prisma, ASSESSMENT_ID, ORGANIZATION_ID);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it("T01/T04 stores the canonical pending profile without emitting legal matching and audits safe refs", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.resolved },
    ]);

    const response = await callback(app, validPayload());
    const body = successBody<VerifiedProfileCallbackDto>(response);
    const verifiedProfileId = body.result.verifiedProfileId;

    assert.equal(response.status, 200);
    assert.equal(
      body.result.lifecycleStatus,
      VERIFIED_PROFILE_STATUSES.pendingApproval,
    );
    assert.ok(verifiedProfileId);
    assert.deepEqual(body.result.sourceArtifactRefs, [
      `wizard:${WIZARD_PROFILE_ID}`,
      `ter:${TECHNICAL_EVIDENCE_REPORT_ID}`,
      `flow:${AI_USAGE_FLOW_ID}`,
    ]);
    assert.deepEqual(body.result.factEvidenceRefs, [EVIDENCE_REF]);

    const [profile, legalMatchingOutbox, audit] = await Promise.all([
      prisma.verifiedProfile.findUnique({ where: { id: verifiedProfileId } }),
      prisma.outboxMessage.findFirst({
        where: { eventType: LEGAL_MATCHING_REQUEST_COMMAND },
      }),
      prisma.authAuditEvent.findFirst({
        where: { eventType: SCAN_EVENT_TYPES.verifiedProfilePersistedAudit },
      }),
    ]);

    assert.equal(profile?.aiUsageFlowId, AI_USAGE_FLOW_ID);
    assert.equal(profile?.assessmentId, ASSESSMENT_ID);
    assert.equal(profile?.organizationId, ORGANIZATION_ID);
    assert.equal(profile?.wizardProfileId, WIZARD_PROFILE_ID);
    assert.equal(
      profile?.technicalEvidenceReportId,
      TECHNICAL_EVIDENCE_REPORT_ID,
    );
    assert.deepEqual(profile?.reconciliationDecisionRefs, [
      "reconciliation:conflict-1",
    ]);
    assert.equal(profile?.idempotencyKey, DEFAULT_IDEMPOTENCY_KEY);
    assert.equal(profile?.status, VERIFIED_PROFILE_STATUSES.pendingApproval);
    assert.equal(profile?.approvedAt, null);
    assert.equal(profile?.approvedById, null);

    const profileData = profile?.profileData as {
      verified_claims?: unknown;
      fact_evidence_refs?: unknown;
      verification_source?: unknown;
      wizard_context?: unknown;
      evidence_chain_integrity?: unknown;
    };
    assert.deepEqual(profileData.verified_claims, [
      { claim_id: "claim-1", evidence_refs: [EVIDENCE_REF] },
    ]);
    assert.deepEqual(profileData.fact_evidence_refs, [EVIDENCE_REF]);
    assert.equal(profileData.verification_source, "TECHNICAL_PLUS_WIZARD");
    assert.deepEqual(profileData.wizard_context, {
      wizard_profile_id: WIZARD_PROFILE_ID,
      version: 1,
    });
    assert.equal(profileData.evidence_chain_integrity, true);
    assert.ok(
      (profile?.gatesPassedAt as { reconciliation_complete?: string } | null)
        ?.reconciliation_complete,
    );

    assert.equal(legalMatchingOutbox, null);
    assert.equal(audit?.resourceId, verifiedProfileId);
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

  it("T01b emits legal-matching work only after Manager approval", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.resolved },
    ]);

    const generated = await callback(app, validPayload());
    const generatedBody = successBody<VerifiedProfileCallbackDto>(generated);
    const verifiedProfileId = generatedBody.result.verifiedProfileId;
    const token = await signInManager(app);

    const approved = await httpRequest(app)
      .post(
        `/assessments/${ASSESSMENT_ID}/verified-profiles/${verifiedProfileId}/approve`,
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
    assert.equal(approvedBody.verified_profile_id, verifiedProfileId);
    assert.equal(approvedBody.status, VERIFIED_PROFILE_STATUSES.approved);
    assert.equal(approvedBody.approved_by_id, "user-1");
    assert.ok(approvedBody.approved_at);

    const [profile, outbox, audit] = await Promise.all([
      prisma.verifiedProfile.findUnique({ where: { id: verifiedProfileId } }),
      prisma.outboxMessage.findFirst({
        where: {
          eventType: LEGAL_MATCHING_REQUEST_COMMAND,
          aggregateId: verifiedProfileId,
        },
      }),
      prisma.authAuditEvent.findFirst({
        where: {
          eventType: SCAN_EVENT_TYPES.verifiedProfileApprovedAudit,
          resourceId: verifiedProfileId,
        },
      }),
    ]);

    assert.equal(profile?.status, VERIFIED_PROFILE_STATUSES.approved);
    assert.equal(profile?.approvedById, "user-1");
    assert.ok(profile?.approvedAt);
    assert.equal(outbox?.aggregateId, verifiedProfileId);
    assert.equal(
      (outbox?.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(
      (outbox?.payload as { result?: string }).result,
      LEGAL_MATCHING_REQUEST_COMMAND,
    );
    assert.equal(
      (outbox?.payload as { corpusVersionId?: string }).corpusVersionId,
      "corpus-ready-1",
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
    const verifiedProfileId = generatedBody.result.verifiedProfileId;
    const token = await signInManager(app);
    const path = `/assessments/${ASSESSMENT_ID}/verified-profiles/${verifiedProfileId}/approve`;

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
          eventType: LEGAL_MATCHING_REQUEST_COMMAND,
          aggregateId: verifiedProfileId,
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

  it("T03 replays the same pinned idempotency key without creating a second profile", async () => {
    await seedConflicts(prisma, [
      { id: "conflict-1", status: CONFLICT_RECORD_STATUSES.resolved },
    ]);

    const first = await callback(app, validPayload());
    const firstBody = successBody<VerifiedProfileCallbackDto>(first);
    const replay = await callback(app, validPayload());
    const replayBody = successBody<VerifiedProfileCallbackDto>(replay);

    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(
      replayBody.result.verifiedProfileId,
      firstBody.result.verifiedProfileId,
    );
    assert.equal(await prisma.verifiedProfile.count(), 1);
    assert.equal(
      await prisma.outboxMessage.count({
        where: { eventType: SCAN_EVENT_TYPES.verifiedProfilePersisted },
      }),
      1,
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
      where: { assessmentId: ASSESSMENT_ID },
    });
    await prisma.wizardProfile.create({
      data: {
        id: "reconciliation-context-wizard-1",
        assessmentId: ASSESSMENT_ID,
        organizationId: ORGANIZATION_ID,
        ownerId: "user-1",
        answers: { aiPurpose: "decision_support" },
      },
    });

    const response = await httpRequest(app)
      .get(
        `/internal/reconciliation/verified-profile-context/${ASSESSMENT_ID}?ai_usage_flow_id=${AI_USAGE_FLOW_ID}`,
      )
      .set("X-Worker-Api-Key", WORKER_KEY);
    const body = successBody<{
      ai_usage_flow: { id: string; claims: unknown };
      conflicts: Array<{ conflict_id: string; status: string }>;
      wizard_profile: { id: string; answers: unknown } | null;
      technical_evidence_report_id: string | null;
    }>(response);

    assert.equal(response.status, 200);
    assert.equal(body.ai_usage_flow.id, AI_USAGE_FLOW_ID);
    assert.deepEqual(body.ai_usage_flow.claims, [
      { claim_id: "claim-1", evidence_refs: [EVIDENCE_REF] },
    ]);
    assert.equal(body.conflicts.length, 1);
    assert.equal(body.conflicts[0]?.conflict_id, "conflict-1");
    assert.equal(body.conflicts[0]?.status, CONFLICT_RECORD_STATUSES.resolved);
    assert.equal(
      body.technical_evidence_report_id,
      TECHNICAL_EVIDENCE_REPORT_ID,
    );
    assert.deepEqual(body.wizard_profile, {
      id: "reconciliation-context-wizard-1",
      assessment_id: ASSESSMENT_ID,
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
      .send(validPayload());

    assert.equal(updateAttempt.status, 404);
    assert.equal(await prisma.verifiedProfile.count(), 1);
  });

  it("rejects a missing pinned artifact and malformed canonical input", async () => {
    const missingFlow = await callback(
      app,
      validPayload({ ai_usage_flow_id: "missing-flow" }),
    );
    assertError(
      missingFlow.status,
      missingFlow.body,
      404,
      SCAN_ERROR_CODES.evidenceReportNotFound,
    );

    const invalidInput = await callback(
      app,
      validPayload({ idempotency_key: "" }),
    );
    assertError(
      invalidInput.status,
      invalidInput.body,
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
    ai_usage_flow_id: AI_USAGE_FLOW_ID,
    assessment_id: ASSESSMENT_ID,
    wizard_profile_id: WIZARD_PROFILE_ID,
    technical_evidence_report_id: TECHNICAL_EVIDENCE_REPORT_ID,
    reconciliation_decision_refs: ["reconciliation:conflict-1"],
    idempotency_key: DEFAULT_IDEMPOTENCY_KEY,
    organization_id: ORGANIZATION_ID,
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
  await prisma.wizardProfile.deleteMany();
  await prisma.legalRetrievalIndex.deleteMany();
  await prisma.legalDocumentChunk.deleteMany();
  await prisma.legalSourceDocument.deleteMany();
  await prisma.legalCorpusVersion.deleteMany();
  await prisma.legalRuleCatalogVersion.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.assessment.deleteMany();
}

async function seedReadyLegalMatchingTarget(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.legalCorpusVersion.create({
    data: {
      id: "corpus-ready-1",
      version: "corpus-ready-1",
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      sourceManifest: {},
      approvedAt: new Date("2026-08-12T00:00:00.000Z"),
      retrievalIndexes: {
        create: {
          id: "index-ready-1",
          version: "index-ready-1",
          status: LegalRetrievalIndexStatus.VALID,
          configHash:
            "sha256:2e5606c22f82d4607160a3d8743ce3489b15616c44333c008242f432780394b1",
          contentHash:
            "sha256:6ff279fb6419f64bc17f02eec2296a4e3de1a9d61eaad77ef19b8235c3948232",
          validationManifestRef: "retrieval-validation:index-ready-1",
          validatedAt: new Date("2026-08-12T00:00:00.000Z"),
        },
      },
    },
  });
  await prisma.legalRuleCatalogVersion.create({
    data: {
      id: "catalog-ready-1",
      version: "catalog-ready-1",
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      ruleRefs: [],
      approvedAt: new Date("2026-08-12T00:00:00.000Z"),
    },
  });
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
  await prisma.wizardProfile.create({
    data: {
      id: `wizard-${assessmentId}`,
      assessmentId,
      organizationId,
      ownerId: "user-1",
      status: WIZARD_STATUS_CODES.submitted,
      answers: [],
      version: 1,
      submittedAt: new Date("2026-08-12T00:00:00.000Z"),
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
      id: AI_USAGE_FLOW_ID,
      technicalProfileId: `technical-profile-${assessmentId}`,
      assessmentId,
      organizationId,
      schemaVersion: "1.0.0",
      providerVersion: "ai-usage-flow-worker@1.0.0",
      claims: [{ claim_id: "claim-1", evidence_refs: [EVIDENCE_REF] }],
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
      aiUsageFlowId: AI_USAGE_FLOW_ID,
      assessmentId: ASSESSMENT_ID,
      organizationId: ORGANIZATION_ID,
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
    organization_id: ORGANIZATION_ID,
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
      where: { eventType: LEGAL_MATCHING_REQUEST_COMMAND },
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
