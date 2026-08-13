import * as assert from "node:assert/strict";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUTH_MEMBERSHIP_STATUSES } from "@lcsp/contracts/auth";
import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import {
  PBAC_ACTIONS,
  PBAC_DECISION,
  PBAC_REASON_CODE,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import {
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  type TechnicalEvidenceReportStatus,
} from "@lcsp/contracts/scan";
import { SERVICE_HEALTH_STATUSES } from "@lcsp/contracts/shared";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import type { EvidenceDetailDto } from "../src/modules/evidence/application/contracts/evidence/evidence-detail.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const ORGANIZATION_ID = "org-1";
const ASSESSMENT_ID = "assessment-evidence-1";
const MANAGER_PASSWORD = "CorrectHorseBatteryStaple!";
const SAFE_FINDING = {
  finding_id: "finding-1",
  tool: "semgrep",
  finding_type: "AI_MODEL_INVOCATION",
  severity: "HIGH",
  description: "Model invocation detected",
  file_path: "src/ai-client.ts",
  line_number: 42,
};

describe("Get Technical Evidence Report Endpoint (e2e) [MW-evid-001]", () => {
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
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.authPolicy.updateMany({
      where: { id: "policy-manager-workspace" },
      data: { actions: [PBAC_ACTIONS.evidenceRead] },
    });
    await prisma.assessment.create({
      data: {
        id: ASSESSMENT_ID,
        organizationId: ORGANIZATION_ID,
        ownerId: "user-1",
        name: "Evidence assessment",
        status: ASSESSMENT_STATUS_CODES.evidenceRequired,
      },
    });
    managerToken = await signIn("manager@acme.test", MANAGER_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01: Manager reads the newest accepted report with safe locations and provenance", async () => {
    await createReport({
      id: "report-old",
      createdAt: new Date("2026-07-18T00:00:00.000Z"),
    });
    await createReport({
      id: "report-new",
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
    });

    const result = await getEvidence(managerToken, "corr-evidence-manager");
    const body = successBody<EvidenceDetailDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.evidence_report_id, "report-new");
    assert.equal(body.assessment_id, ASSESSMENT_ID);
    assert.equal(body.schema_version, "1.0.0");
    assert.deepEqual(body.tools_version, { semgrep: "1.80.0" });
    assert.deepEqual(body.config_hash, { semgrep: "sha256:rules" });
    assert.deepEqual(body.findings, [SAFE_FINDING]);
    assert.deepEqual(body.privacy_flags, {
      containsSourceCode: false,
      secretsRedacted: true,
    });
    assert.equal(body.status, TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted);
    assert.equal(body.correlationId, "corr-evidence-manager");
  });

  it("T02: scoped Developer receives redacted file and line locations", async () => {
    await createReport();
    const developerToken = await seedDeveloper(ASSESSMENT_ID);

    const result = await getEvidence(developerToken, "corr-evidence-dev");
    const body = successBody<EvidenceDetailDto>(result);

    assert.equal(result.status, 200);
    assert.deepEqual(body.findings, [
      { ...SAFE_FINDING, file_path: null, line_number: null },
    ]);
    const decision = await prisma.authDecisionLog.findFirstOrThrow({
      where: {
        correlationId: "corr-evidence-dev",
        decision: PBAC_DECISION.allow,
      },
    });
    assert.equal(decision.action, PBAC_ACTIONS.evidenceReadRedacted);
    assert.equal(decision.policyId, "policy-evidence-developer");
    assert.equal(decision.policyVersion, "2026-07-19");
  });

  it("T03: missing accepted evidence returns safe EVIDENCE_NOT_FOUND", async () => {
    const result = await getEvidence(managerToken, "corr-evidence-missing");
    assertNotFound(result.status, result.body);
  });

  it("T04: policy with neither evidence action is denied and audited", async () => {
    await createReport();
    await prisma.authPolicy.updateMany({
      where: { id: "policy-manager-workspace" },
      data: { actions: [] },
    });

    const result = await getEvidence(managerToken, "corr-evidence-denied");
    assert.equal(result.status, 403);
    assert.equal(problemCode(result), PBAC_REASON_CODE.denied);
    const decisions = await prisma.authDecisionLog.findMany({
      where: { correlationId: "corr-evidence-denied" },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      decisions.map((decision) => decision.action),
      [PBAC_ACTIONS.evidenceRead, PBAC_ACTIONS.evidenceReadRedacted],
    );
    assert.ok(decisions.every((decision) => decision.policyId));
    assert.ok(decisions.every((decision) => decision.policyVersion));
  });

  it("T05: cross-organization and out-of-scope evidence are cloaked as the same 404", async () => {
    await createReport({ organizationId: "org-other" });
    const foreign = await getEvidence(managerToken, "corr-evidence-foreign");
    assertNotFound(foreign.status, foreign.body);

    await prisma.technicalEvidenceReport.deleteMany();
    await createReport();
    const developerToken = await seedDeveloper("assessment-not-assigned");
    const outOfScope = await getEvidence(
      developerToken,
      "corr-evidence-out-of-scope",
    );
    assertNotFound(outOfScope.status, outOfScope.body);
    assert.deepEqual(
      Object.keys(foreign.body as object).sort(),
      Object.keys(outOfScope.body as object).sort(),
    );
  });

  it("T06: rejected evidence is never returned", async () => {
    await createReport({
      status: TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected,
    });
    const result = await getEvidence(managerToken, "corr-evidence-rejected");
    assertNotFound(result.status, result.body);
  });

  it("T07: response never serializes source, raw output, unsafe keys or secrets", async () => {
    await createReport({
      evidencePayload: {
        findings: [
          {
            ...SAFE_FINDING,
            raw_output: "raw scanner payload",
            source_code: "const apiKey = process.env.API_KEY",
            snippet: "function unsafe() {}",
          },
          {
            ...SAFE_FINDING,
            finding_id: "finding-secret",
            description: "Bearer abc.def-ghi_1234567890",
          },
        ],
      },
    });

    const result = await getEvidence(managerToken, "corr-evidence-safe");
    const body = successBody<EvidenceDetailDto>(result);
    const serialized = JSON.stringify(body);

    assert.equal(result.status, 200);
    assert.deepEqual(body.findings, [SAFE_FINDING]);
    assert.doesNotMatch(serialized, /raw scanner payload|source_code|snippet/i);
    assert.doesNotMatch(serialized, /abc\.def-ghi_1234567890/);

    await prisma.technicalEvidenceReport.deleteMany();
    await createReport({
      configHash: { semgrep: "Bearer abc.def-ghi_1234567890" },
    });
    const unsafeProvenance = await getEvidence(
      managerToken,
      "corr-evidence-unsafe-provenance",
    );
    assertNotFound(unsafeProvenance.status, unsafeProvenance.body);
  });

  async function signIn(email: string, password: string): Promise<string> {
    const result = await httpRequest(app).post("/auth/sign-in").send({
      email,
      password,
      organization_id: ORGANIZATION_ID,
    });
    const token = successBody<SignInSuccess>(result).session_token;
    assert.ok(token, `sign-in must succeed for ${email}`);
    return token;
  }

  async function seedDeveloper(scope: string): Promise<string> {
    await prisma.authPolicy.create({
      data: {
        id: "policy-evidence-developer",
        version: "2026-07-19",
        actions: [PBAC_ACTIONS.evidenceReadRedacted],
        subjectRole: SUBJECT_ROLES.developer,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: ORGANIZATION_ID,
      },
    });
    await prisma.authUser.create({
      data: {
        id: "user-evidence-developer",
        email: "evidence-developer@acme.test",
        passwordHash: hashSecret("DeveloperPassword123!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-evidence-developer",
        userId: "user-evidence-developer",
        organizationId: ORGANIZATION_ID,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.developer, scope },
        policyId: "policy-evidence-developer",
        policyVersion: "2026-07-19",
      },
    });
    return signIn("evidence-developer@acme.test", "DeveloperPassword123!");
  }

  async function createReport(
    overrides: {
      id?: string;
      organizationId?: string;
      status?: TechnicalEvidenceReportStatus;
      evidencePayload?: Prisma.InputJsonValue;
      configHash?: Prisma.InputJsonValue;
      createdAt?: Date;
    } = {},
  ): Promise<void> {
    const id = overrides.id ?? "report-evidence-1";
    await prisma.technicalEvidenceReport.create({
      data: {
        id,
        scanJobId: `scan-job-${id}`,
        assessmentId: ASSESSMENT_ID,
        organizationId: overrides.organizationId ?? ORGANIZATION_ID,
        snapshotId: `snapshot-${id}`,
        toolsVersion: { semgrep: "1.80.0" },
        configHash: overrides.configHash ?? { semgrep: "sha256:rules" },
        evidencePayload: overrides.evidencePayload ?? {
          findings: [SAFE_FINDING],
        },
        privacyFlags: {
          containsSourceCode: false,
          secretsRedacted: true,
        },
        schemaVersion: "1.0.0",
        status: overrides.status ?? TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        rejectionReason:
          overrides.status === TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected
            ? "SCANNER_FAILED"
            : null,
        createdAt: overrides.createdAt,
      },
    });
  }

  function getEvidence(token: string, correlationId: string) {
    return httpRequest(app)
      .get(`/assessments/${ASSESSMENT_ID}/evidence`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-correlation-id", correlationId);
  }
});

function assertNotFound(status: number, value: unknown): void {
  assert.equal(status, 404);
  assert.equal(problemCode(value), EVIDENCE_ERROR_CODES.notFound);
  const body = value as { problem?: { correlationId?: string } };
  assert.ok(body.problem?.correlationId);
  assert.deepEqual(Object.keys(body).sort(), [
    SERVICE_HEALTH_STATUSES.ok,
    "problem",
  ]);
}
