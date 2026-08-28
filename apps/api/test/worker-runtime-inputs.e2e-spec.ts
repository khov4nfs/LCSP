import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  EvidenceAcceptanceStatus,
  PrismaClient,
  WizardProfileStatus,
} from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import {
  pushPrismaSchema,
  seedRepositoryScanGraph,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

type ReportRuntimeBody = {
  status: string;
  assessment_id: string;
  evidence_payload: {
    technical_findings: Array<{ finding_type: string }>;
  };
};

type TechnicalProfileRuntimeBody = {
  technical_profile_id: string;
  evidence_report_id: string;
  dependency_ai_packages: string[];
};

type WizardRuntimeBody = {
  id: string;
  answers: { businessProcess: string };
};

describe("Worker runtime input endpoints (e2e) [LCSP-155]", () => {
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
    await prisma.wizardProfile.deleteMany();
    await prisma.technicalProfile.deleteMany();
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.repositoryScanJob.deleteMany();
    await prisma.repositorySnapshot.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await prisma.user.deleteMany();

    await seedRepositoryScanGraph(prisma, {
      assessmentId: "assessment-runtime-1",
      userId: "user-runtime-1",
      connectionId: "connection-runtime-1",
      snapshotId: "snapshot-runtime-1",
      scanJobId: "scan-runtime-1",
    });

    await prisma.technicalEvidenceReport.create({
      data: {
        id: "report-runtime-1",
        scanJobId: "scan-runtime-1",
        assessmentId: "assessment-runtime-1",
        snapshotId: "snapshot-runtime-1",
        toolsVersion: { semgrep: "1.0" },
        configHash: { semgrep: "sha256:test" },
        evidencePayload: {
          ai_usage_signals: [
            {
              id: "finding-invocation",
              signal_type: "AI_MODEL_INVOCATION",
              evidence_ref: "finding-invocation",
            },
          ],
          technical_findings: [
            {
              finding_id: "finding-status",
              finding_type: "STATUS_UPDATE_SIGNAL",
            },
          ],
        },
        privacyFlags: { containsSourceCode: false, secretsRedacted: true },
        schemaVersion: "1.0.0",
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
    });
    await prisma.technicalProfile.create({
      data: {
        id: "profile-runtime-1",
        evidenceReportId: "report-runtime-1",
        assessmentId: "assessment-runtime-1",
        schemaVersion: "1.0.0",
        providerVersion: "technical-profile-worker@1",
        profileData: {
          ai_detected: "confirmed",
          dependency_ai_packages: ["openai"],
          evidence_refs: ["finding-invocation"],
        },
        privacyFlags: { containsSourceCode: false, secretsRedacted: true },
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
    });
    await prisma.wizardProfile.create({
      data: {
        id: "wizard-runtime-1",
        assessmentId: "assessment-runtime-1",
        ownerId: "user-runtime-1",
        version: 1,
        status: WizardProfileStatus.SUBMITTED,
        answers: {
          businessProcess: "loan_approval",
          aiPurpose: "decision_support",
        },
        submittedAt: new Date("2026-08-08T01:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("serves all persisted inputs required by the LangGraph workers", async () => {
    const report = await workerGet(
      "/internal/evidence/reports/report-runtime-1",
    );
    const reportBody = report.body as ReportRuntimeBody;
    assert.equal(report.status, 200);
    assert.equal(reportBody.status, "accepted");
    assert.equal(reportBody.assessment_id, "assessment-runtime-1");
    assert.equal(
      reportBody.evidence_payload.technical_findings[0]?.finding_type,
      "STATUS_UPDATE_SIGNAL",
    );

    const profile = await workerGet(
      "/internal/evidence/technical-profiles/profile-runtime-1",
    );
    const profileBody = profile.body as TechnicalProfileRuntimeBody;
    assert.equal(profile.status, 200);
    assert.equal(profileBody.technical_profile_id, "profile-runtime-1");
    assert.equal(profileBody.evidence_report_id, "report-runtime-1");
    assert.deepEqual(profileBody.dependency_ai_packages, ["openai"]);

    const wizard = await workerGet(
      "/internal/assessments/assessment-runtime-1/wizard-profile",
    );
    const wizardBody = wizard.body as WizardRuntimeBody;
    assert.equal(wizard.status, 200);
    assert.equal(wizardBody.id, "wizard-runtime-1");
    assert.equal(wizardBody.answers.businessProcess, "loan_approval");
  });

  it("rejects worker runtime reads without the worker API key", async () => {
    const response = await httpRequest(app).get(
      "/internal/evidence/reports/report-runtime-1",
    );
    assert.equal(response.status, 401);
  });

  function workerGet(path: string) {
    return httpRequest(app)
      .get(path)
      .set("X-Worker-Api-Key", WORKER_KEY)
      .set("X-Correlation-Id", "runtime-inputs-corr-1");
  }
});
