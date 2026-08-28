/** MW-wiz-004: Wizard Readiness Export Endpoint. */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  ASSESSMENT_STATUS_CODES,
  type AssessmentStatusCode,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { WIZARD_EVENT_TYPES } from "@lcsp/contracts/wizard";
import {
  READINESS_CLASSIFICATION_STATUSES,
  READINESS_EXPORT_ARTIFACT_TYPES,
  READINESS_EXPORT_ERROR_CODES,
  READINESS_EXPORT_STATUSES,
} from "@lcsp/contracts/wizard";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import type { ReadinessExportResponse } from "../src/modules/wizard/application/contracts/wizard/readiness-export.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedRepositoryScanGraph,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

describe("Wizard Readiness Export Endpoint (e2e) [MW-wiz-004]", () => {
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

  it("T01/T05/T06 generates a readiness-only export for a submitted wizard with locked classification", async () => {
    await seedSubmittedWizard(prisma);

    const response = await requestExport(app, managerToken);
    const body = successBody<ReadinessExportResponse>(response);
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 201);
    assert.equal(body.status, READINESS_EXPORT_STATUSES.generated);
    assert.equal(body.label, "Wizard Readiness Export");
    assert.equal(
      body.artifact_type,
      READINESS_EXPORT_ARTIFACT_TYPES.wizardReadinessExport,
    );
    assert.equal(body.readiness_only, true);
    assert.equal(
      body.classification_status,
      READINESS_CLASSIFICATION_STATUSES.lockedEvidenceRequired,
    );
    assert.equal(body.classification_locked, true);
    assert.equal(body.assessment_id, "assessment-1");
    assert.equal(body.owner_id, "user-1");
    assert.equal(body.version, 1);
    assert.ok(body.generated_at);
    assert.ok(body.export_id);
    assert.equal(body.media_type, "application/pdf");
    assert.equal(body.file_name, "wizard-readiness-export-v1.pdf");
    assert.equal(
      body.download_url,
      `/assessments/assessment-1/wizard/readiness-exports/${body.export_id}/download`,
    );
    assert.ok(body.missing_evidence);
    assert.ok(body.preparation_guidance);
    assert.ok(body.unresolved_unknowns);
    assert.ok(body.missing_evidence.length >= 1);
    assert.ok(body.preparation_guidance.length >= 1);
    assert.ok(
      body.unresolved_unknowns.some((item) => item.includes("dataTypes")),
      "unknown wizard answers must remain explicit unresolved context",
    );
    assert.doesNotMatch(serialized, /\b(HIGH|MEDIUM|LOW)\b/);
    assert.doesNotMatch(serialized, /\brisk\b/i);
    assert.doesNotMatch(
      serialized,
      /classification result|final classification/i,
    );
    assert.doesNotMatch(serialized, /\bnon-compliant\b/i);

    const [exportRecord, audit] = await Promise.all([
      prisma.readinessExport.findUnique({ where: { id: body.export_id } }),
      prisma.auditEvent.findFirst({
        where: { eventType: WIZARD_EVENT_TYPES.readinessExportGenerated },
      }),
    ]);

    assert.equal(exportRecord?.assessmentId, "assessment-1");
    assert.equal(exportRecord?.ownerId, "user-1");
    assert.equal(exportRecord?.version, 1);
    assert.equal(exportRecord?.status, READINESS_EXPORT_STATUSES.generated);
    const exportContent = exportRecord?.contentJson as {
      wizard_profile?: {
        sections?: Array<{
          title: string;
          answers: Array<{ label: string; value: string }>;
        }>;
      };
    } | null;
    const wizardAnswers = exportContent?.wizard_profile?.sections?.flatMap(
      (section) => section.answers,
    );
    assert.ok(wizardAnswers?.some((answer) => answer.label === "Purpose"));
    assert.ok(
      wizardAnswers?.some((answer) =>
        answer.value.includes("Route support requests"),
      ),
    );
    assert.ok(
      wizardAnswers?.some(
        (answer) => answer.label === "Data types" && answer.value === "Unknown",
      ),
    );
    assert.ok(
      wizardAnswers?.some(
        (answer) =>
          answer.label === "User impact" && answer.value === "Limited impact",
      ),
    );
    assert.doesNotMatch(JSON.stringify(exportContent), /\b(HIGH|MEDIUM|LOW)\b/);
    assert.doesNotMatch(JSON.stringify(exportContent), /\brisk\b/i);
    assert.equal(audit?.resourceId, body.export_id);
    assert.doesNotMatch(JSON.stringify(audit?.payload), /answers|purpose/i);

    const download = await httpRequest(app)
      .get(body.download_url)
      .set("Authorization", `Bearer ${managerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    assert.equal(download.status, 200);
    assert.match(download.headers["content-type"], /^application\/pdf/);
    assert.equal(
      download.headers["content-disposition"],
      'attachment; filename="wizard-readiness-export-v1.pdf"',
    );
    assert.ok(Buffer.isBuffer(download.body));
    assert.equal(download.body.subarray(0, 5).toString("ascii"), "%PDF-");
    const pdfText = download.body.toString("latin1");
    assert.match(pdfText, /AI SYSTEM DECLARATION AND INFORMATION RECORD/);
    assert.match(pdfText, /READINESS-ONLY RECORD/);
    assert.match(pdfText, /PROFILE IDENTIFICATION INFORMATION/);
    assert.match(pdfText, /SOCIALIST REPUBLIC OF VIET NAM/);
    assert.match(pdfText, /1\. GENERAL SYSTEM INFORMATION/);
    assert.match(pdfText, /2\. PRELIMINARY SCREENING/);
    assert.match(pdfText, /3\. BUSINESS CONTEXT AND PURPOSE/);
    assert.match(pdfText, /4\. DATA AND AFFECTED SUBJECTS/);
    assert.match(pdfText, /5\. DECISION ROLE AND HUMAN OVERSIGHT/);
    assert.match(pdfText, /6\. PROVIDER AND DEPLOYMENT SCOPE/);
    assert.match(pdfText, /7\. INDICATORS REQUIRING REVIEW/);
    assert.match(pdfText, /FIELD/);
    assert.match(pdfText, /RESPONSE/);
    assert.match(
      pdfText,
      /\(PURPOSE\) Tj[\s\S]{0,400}% CHECKBOX_CHECKED[\s\S]{0,400}\(Route support requests/,
    );
    assert.match(
      pdfText,
      /\(DATA TYPES\) Tj[\s\S]{0,400}% CHECKBOX_UNCHECKED[\s\S]{0,400}\(Unknown\) Tj/,
    );
    assert.match(pdfText, /8\. RECORD STATUS AND NEXT ACTIONS/);
    assert.match(pdfText, /MISSING TECHNICAL EVIDENCE/);
    assert.match(pdfText, /INFORMATION REQUIRING VERIFICATION/);
    assert.match(pdfText, /9\. DECLARATION AND APPROVAL/);
    assert.match(pdfText, /DECLARED BY/);
    assert.match(pdfText, /COMPLIANCE REVIEW/);
    assert.match(pdfText, /APPROVAL REPRESENTATIVE/);
    assert.doesNotMatch(pdfText, /\b(HIGH|MEDIUM|LOW)\b/);
    assert.doesNotMatch(pdfText, /\bnon-compliant\b/i);
  });

  it("T02 rejects readiness export when accepted technical evidence already exists", async () => {
    await seedSubmittedWizard(prisma);
    await seedRepositoryScanGraph(prisma, {
      assessmentId: "assessment-1",
      userId: "user-1",
      connectionId: "connection-1",
      snapshotId: "snapshot-1",
      scanJobId: "scan-job-1",
    });
    await prisma.technicalEvidenceReport.create({
      data: {
        id: "evidence-1",
        scanJobId: "scan-job-1",
        assessmentId: "assessment-1",
        snapshotId: "snapshot-1",
        toolsVersion: { semgrep: "1.0.0" },
        configHash: { semgrep: "sha256:abc" },
        evidencePayload: {},
        privacyFlags: { containsSourceCode: false, secretsRedacted: true },
        schemaVersion: "1.0.0",
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      },
    });

    const response = await requestExport(app, managerToken);

    assert.equal(response.status, 409);
    assert.equal(
      problemCode(response),
      READINESS_EXPORT_ERROR_CODES.requiresLockedClassification,
    );
  });

  it("T03 rejects readiness export before wizard submission", async () => {
    await seedAssessment(prisma, ASSESSMENT_STATUS_CODES.wizardInProgress);

    const response = await requestExport(app, managerToken);

    assert.equal(response.status, 422);
    assert.equal(
      problemCode(response),
      READINESS_EXPORT_ERROR_CODES.wizardNotSubmitted,
    );
  });

  it("T08 creates a new immutable row for each generated export", async () => {
    await seedSubmittedWizard(prisma);

    const first = await requestExport(app, managerToken);
    const second = await requestExport(app, managerToken);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(
      successBody<ReadinessExportResponse>(first).export_id,
      successBody<ReadinessExportResponse>(second).export_id,
    );
    assert.equal(await prisma.readinessExport.count(), 2);
    assert.deepEqual(
      (
        await prisma.readinessExport.findMany({
          orderBy: { version: "asc" },
          select: { version: true },
        })
      ).map((record) => record.version),
      [1, 2],
    );
  });
});

function requestExport(app: INestApplication, token: string) {
  return httpRequest(app)
    .post("/assessments/assessment-1/wizard/readiness-export")
    .set("Authorization", `Bearer ${token}`)
    .set("X-Correlation-Id", "readiness-export-corr-1")
    .send({});
}

async function resetDomainData(prisma: PrismaClient): Promise<void> {
  await prisma.readinessExport.deleteMany();
  await prisma.technicalEvidenceReport.deleteMany();
  await prisma.wizardProfile.deleteMany();
  await prisma.assessment.deleteMany();
}

async function seedSubmittedWizard(prisma: PrismaClient): Promise<void> {
  await seedAssessment(prisma, ASSESSMENT_STATUS_CODES.wizardSubmitted);
  await prisma.wizardProfile.create({
    data: {
      id: "wizard-profile-1",
      assessmentId: "assessment-1",
      ownerId: "user-1",
      version: 3,
      status: WIZARD_STATUS_CODES.submitted,
      submittedAt: new Date("2026-07-26T00:00:00.000Z"),
      answers: [
        {
          questionId: "purpose",
          answerState: "ANSWERED",
          value: "Route support requests to the right operations team.",
          updatedAt: new Date().toISOString(),
        },
        {
          questionId: "sector",
          answerState: "ANSWERED",
          value: "customer-support",
          updatedAt: new Date().toISOString(),
        },
        {
          questionId: "dataTypes",
          answerState: "EXPLICIT_UNKNOWN",
          value: null,
          updatedAt: new Date().toISOString(),
        },
        {
          questionId: "userImpact",
          answerState: "ANSWERED",
          value: "LOW",
          updatedAt: new Date().toISOString(),
        },
        {
          questionId: "highImpactIndicators",
          answerState: "ANSWERED",
          value: ["Recruiting workflow indicator"],
          updatedAt: new Date().toISOString(),
        },
        {
          questionId: "prohibitedRiskSignals",
          answerState: "EXPLICIT_UNKNOWN",
          value: null,
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  });
}

async function seedAssessment(
  prisma: PrismaClient,
  status: AssessmentStatusCode,
): Promise<void> {
  await prisma.assessment.create({
    data: {
      id: "assessment-1",
      ownerId: "user-1",
      name: "Wizard readiness export assessment",
      status,
    },
  });
}
