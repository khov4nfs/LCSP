/** MW-qa-003: Manager-only golden path across the API boundary. */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUTH_INVITATION_STATES } from "@lcsp/contracts/auth";
import { DOCUMENT_REQUEST_STATUSES } from "@lcsp/contracts/document";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  AI_USAGE_FLOW_STATUSES,
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CONFLICT_RECORD_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_STATUSES,
  OVERALL_COVERAGE_STATUSES,
  SCAN_CALLBACK_STATUSES,
  TECHNICAL_PROFILE_STATUSES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";

import { AppModule } from "../src/app.module.js";
import {
  toPrismaDocumentRequestStatus,
  toPrismaOverallCoverageStatus,
} from "../src/infrastructure/prisma/prisma-enum-mappers.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

describe("Manager Golden Path (e2e) [MW-qa-003]", () => {
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
    await grantGoldenPathActions(prisma);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("lets an approved Manager complete the entire path without a Developer", async () => {
    const accepted = await httpRequest(app)
      .post("/auth/register-approved-path")
      .send({
        invite_id: "invite-approved",
        password: "DeveloperPass123!",
      });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    assert.equal((accepted.body as { ok?: boolean }).ok, true);

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "invitee@acme.test",
      password: "DeveloperPass123!",
      organization_id: "org-1",
    });
    assert.equal(signIn.status, 200);
    const token = successBody<{ session_token: string }>(signIn).session_token;
    assert.ok(token);
    assert.doesNotMatch(
      JSON.stringify(signIn.body),
      /https?:\/\/[^\s]*session/i,
    );

    const created = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Manager-only assessment" });
    assert.equal(created.status, 201);
    const assessmentId = successBody<{ assessment_id: string }>(
      created,
    ).assessment_id;
    assert.ok(assessmentId);
    assert.doesNotMatch(
      JSON.stringify(successBody<object>(created)),
      /developer/i,
    );

    const wizard = await httpRequest(app)
      .post(`/assessments/${assessmentId}/wizard/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answers: validWizardAnswers });
    assert.equal(wizard.status, 200);
    assert.equal(
      successBody<{ assessment_status: string }>(wizard).assessment_status,
      ASSESSMENT_STATUS_CODES.wizardSubmitted,
    );

    await seedRepositorySnapshot(prisma, assessmentId);
    const scan = await httpRequest(app)
      .post(`/assessments/${assessmentId}/scan-jobs`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        snapshot_id: "golden-snapshot",
        trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
        idempotency_key: "manager-golden-path-scan",
      });
    assert.equal(scan.status, 201);
    const scanJobId = successBody<{ scan_job_id: string }>(scan).scan_job_id;
    await prisma.repositoryScanJob.update({
      where: { id: scanJobId },
      data: { status: REPOSITORY_SCAN_JOB_STATUSES.running },
    });

    const evidence = await httpRequest(app)
      .post(`/internal/scan-jobs/${scanJobId}/callback`)
      .set("X-Worker-Api-Key", WORKER_KEY)
      .send({
        scan_job_id: scanJobId,
        tools_version: { semgrep: "1.0.0" },
        config_hash: { semgrep: "sha256:golden" },
        evidence_payload: { findings: [{ finding_id: "golden-finding" }] },
        privacy_flags: { containsSourceCode: false, secretsRedacted: true },
        schema_version: "1.0.0",
        status: SCAN_CALLBACK_STATUSES.success,
      });
    assert.equal(evidence.status, 200);
    assert.equal(successBody<{ accepted: boolean }>(evidence).accepted, true);

    const acceptedEvidence =
      await prisma.technicalEvidenceReport.findUniqueOrThrow({
        where: { scanJobId },
      });
    await seedAcceptedFlow(prisma, assessmentId, acceptedEvidence.id);
    const detected = await httpRequest(app)
      .post("/internal/reconciliation/conflict-callback")
      .set("X-Worker-Api-Key", WORKER_KEY)
      .send({
        ai_usage_flow_id: "golden-ai-flow",
        assessment_id: assessmentId,
        schema_version: "1.0.0",
        provider_version: "conflict-detection-worker@1.0.0",
        conflicts: [
          {
            conflict_type: "evidence_contradiction",
            conflict_score: 0.5,
            score_explanation: "Manager review required.",
            evidence_refs: [`${acceptedEvidence.id}::golden-finding`],
          },
        ],
        privacy_flags: { containsSourceCode: false, secretsRedacted: true },
      });
    assert.equal(detected.status, 200);

    const conflicts = await httpRequest(app)
      .get(`/assessments/${assessmentId}/conflicts`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(conflicts.status, 200);
    const conflictId = successBody<{
      conflicts: Array<{ conflict_id: string }>;
    }>(conflicts).conflicts[0]?.conflict_id;
    assert.ok(conflictId);
    const resolved = await httpRequest(app)
      .patch(`/assessments/${assessmentId}/conflicts/${conflictId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: CONFLICT_RECORD_STATUSES.resolved });
    assert.equal(resolved.status, 200);
    assert.equal(
      successBody<{ all_conflicts_resolved: boolean }>(resolved)
        .all_conflicts_resolved,
      true,
    );

    await seedClassificationInputs(prisma, assessmentId);
    const approvedProfile = await httpRequest(app)
      .post(
        `/assessments/${assessmentId}/verified-profiles/golden-verified-profile/approve`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(
      approvedProfile.status,
      200,
      JSON.stringify(approvedProfile.body),
    );
    assert.equal(
      successBody<{ status: string }>(approvedProfile).status,
      VERIFIED_PROFILE_STATUSES.approved,
    );

    const classified = await httpRequest(app)
      .post("/internal/classification/result-callback")
      .set("X-Worker-Api-Key", WORKER_KEY)
      .send({
        legal_rule_match_id: "golden-rule-match",
        verified_profile_id: "golden-verified-profile",
        assessment_id: assessmentId,
        schema_version: "1.0.0",
        classification_data: {
          system_type: "AI_SYSTEM",
          citation_basis: ["chunk-1"],
        },
        guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
      });
    assert.equal(classified.status, 200);

    const report = await httpRequest(app)
      .post(`/assessments/${assessmentId}/documents/final-report`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(report.status, 202);
    const documentRequestId = successBody<{ document_request_id: string }>(
      report,
    ).document_request_id;
    await prisma.documentRequest.update({
      where: { id: documentRequestId },
      data: {
        status: toPrismaDocumentRequestStatus(DOCUMENT_REQUEST_STATUSES.ready),
        documentUrl: "https://example.test/files/manager-final-report.pdf",
      },
    });
    const ready = await httpRequest(app)
      .get(`/assessments/${assessmentId}/documents/${documentRequestId}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(ready.status, 200);
    const downloadUrl = successBody<{ download_url: string }>(
      ready,
    ).download_url;
    assert.ok(downloadUrl);
    assert.doesNotMatch(downloadUrl, /session_token/i);
    const download = await httpRequest(app).get(downloadUrl);
    assert.equal(download.status, 302);
    assert.equal(
      download.headers.location,
      "https://example.test/files/manager-final-report.pdf",
    );

    const [invitation, managerMembership] = await Promise.all([
      prisma.authInvitation.findUniqueOrThrow({
        where: { id: "invite-approved" },
      }),
      prisma.authMembership.findFirstOrThrow({
        where: { user: { email: "invitee@acme.test" } },
      }),
    ]);
    assert.equal(invitation.state, AUTH_INVITATION_STATES.consumed);
    assert.equal(
      (managerMembership.subjectAttributes as { role: string }).role,
      SUBJECT_ROLES.manager,
    );
  });
});

const validWizardAnswers = [
  {
    questionId: "businessProcess",
    value: "Assess an internal AI system",
    answerState: "ANSWERED",
    updatedAt: "2026-07-31T00:00:00.000Z",
  },
  {
    questionId: "aiPurpose",
    value: "Finance",
    answerState: "ANSWERED",
    updatedAt: "2026-07-31T00:00:00.000Z",
  },
  {
    questionId: "dataTypes",
    value: ["PII"],
    answerState: "ANSWERED",
    updatedAt: "2026-07-31T00:00:00.000Z",
  },
  {
    questionId: "affectedSubjects",
    value: ["Internal employees"],
    answerState: "ANSWERED",
    updatedAt: "2026-07-31T00:00:00.000Z",
  },
  {
    questionId: "decisionRole",
    value: "Advisory",
    answerState: "ANSWERED",
    updatedAt: "2026-07-31T00:00:00.000Z",
  },
  {
    questionId: "humanReview",
    value: "Manager review",
    answerState: "ANSWERED",
    updatedAt: "2026-07-31T00:00:00.000Z",
  },
  {
    questionId: "externalLlmUsage",
    value: "no",
    answerState: "ANSWERED",
    updatedAt: "2026-07-31T00:00:00.000Z",
  },
];

async function grantGoldenPathActions(prisma: PrismaClient): Promise<void> {
  const policy = await prisma.authPolicy.findUniqueOrThrow({
    where: {
      id_version: { id: "policy-manager-workspace", version: "2026-06-26" },
    },
  });
  await prisma.authPolicy.update({
    where: { id_version: { id: policy.id, version: policy.version } },
    data: {
      actions: [
        ...new Set([
          ...policy.actions,
          PBAC_ACTIONS.conflictRead,
          PBAC_ACTIONS.conflictResolve,
          PBAC_ACTIONS.documentRead,
          PBAC_ACTIONS.verifiedProfileApprove,
        ]),
      ],
    },
  });
}

async function seedRepositorySnapshot(
  prisma: PrismaClient,
  assessmentId: string,
): Promise<void> {
  await prisma.repositoryConnection.create({
    data: {
      id: "golden-connection",
      assessmentId,
      organizationId: "org-1",
      userId: "user-1",
      installationId: "installation-1",
      repositoryId: "repo-1",
      repositoryName: "example-repo",
      repositoryFullName: "acme/example-repo",
      defaultBranch: "main",
      permissions: { contents: "read" },
      status: REPOSITORY_CONNECTION_STATUSES.active,
    },
  });
  await prisma.repositorySnapshot.create({
    data: {
      id: "golden-snapshot",
      assessmentId,
      organizationId: "org-1",
      connectionId: "golden-connection",
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

async function seedAcceptedFlow(
  prisma: PrismaClient,
  assessmentId: string,
  evidenceReportId: string,
): Promise<void> {
  await prisma.technicalProfile.create({
    data: {
      id: "golden-technical-profile",
      evidenceReportId,
      assessmentId,
      organizationId: "org-1",
      schemaVersion: "1.0.0",
      providerVersion: "test",
      profileData: {},
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: TECHNICAL_PROFILE_STATUSES.accepted,
    },
  });
  await prisma.aIUsageFlow.create({
    data: {
      id: "golden-ai-flow",
      technicalProfileId: "golden-technical-profile",
      assessmentId,
      organizationId: "org-1",
      schemaVersion: "1.0.0",
      providerVersion: "test",
      claims: [],
      unknownUsages: [],
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: AI_USAGE_FLOW_STATUSES.accepted,
    },
  });
}

async function seedClassificationInputs(
  prisma: PrismaClient,
  assessmentId: string,
): Promise<void> {
  await prisma.verifiedProfile.create({
    data: {
      id: "golden-verified-profile",
      aiUsageFlowId: "golden-ai-flow",
      assessmentId,
      organizationId: "org-1",
      schemaVersion: "1.0.0",
      providerVersion: "test",
      profileData: {},
      gatesPassedAt: {},
      status: VERIFIED_PROFILE_STATUSES.pendingApproval,
    },
  });
  await prisma.legalRuleMatch.create({
    data: {
      id: "golden-rule-match",
      verifiedProfileId: "golden-verified-profile",
      assessmentId,
      organizationId: "org-1",
      corpusVersionId: "LCSP-LEGAL-CORPUS-v0.1.0",
      legalRuleCatalogVersionId: "LCSP-RULE-CATALOG-v0.1.0",
      schemaVersion: "1.0.0",
      matches: [],
      citationAllowlist: ["chunk-1"],
      overallCoverageStatus: toPrismaOverallCoverageStatus(
        OVERALL_COVERAGE_STATUSES.completeCitation,
      ),
      guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
      status: LEGAL_RULE_MATCH_STATUSES.accepted,
    },
  });
}

async function resetDomainData(prisma: PrismaClient): Promise<void> {
  await prisma.documentRequest.deleteMany();
  await prisma.classificationResult.deleteMany();
  await prisma.legalRuleMatch.deleteMany();
  await prisma.verifiedProfile.deleteMany();
  await prisma.conflictRecord.deleteMany();
  await prisma.aIUsageFlow.deleteMany();
  await prisma.technicalProfile.deleteMany();
  await prisma.technicalEvidenceReport.deleteMany();
  await prisma.repositoryScanJob.deleteMany();
  await prisma.repositorySnapshot.deleteMany();
  await prisma.repositoryConnection.deleteMany();
  await prisma.wizardProfile.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.assessment.deleteMany();
}
