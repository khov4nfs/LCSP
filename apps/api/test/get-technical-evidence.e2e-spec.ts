import * as assert from "node:assert/strict";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
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
  seedRepositoryScanGraph,
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
    await prisma.assessment.create({
      data: {
        id: ASSESSMENT_ID,
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

  it("T02: scoped SystemAdmin receives redacted file and line locations", async () => {
    await createReport();
    const systemAdminToken = await seedSystemAdmin();

    const result = await getEvidence(systemAdminToken, "corr-evidence-dev");
    const body = successBody<EvidenceDetailDto>(result);

    assert.equal(result.status, 200);
    assert.deepEqual(body.findings, [
      { ...SAFE_FINDING, file_path: null, line_number: null },
    ]);
    const decision = await prisma.auditEvent.findFirstOrThrow({
      where: {
        correlationId: "corr-evidence-dev",
        decision: AUDIT_DECISIONS.allow,
      },
    });
    assert.equal(decision.resourceId, `assessment:${ASSESSMENT_ID}`);
  });

  it("T03: missing accepted evidence returns safe EVIDENCE_NOT_FOUND", async () => {
    const result = await getEvidence(managerToken, "corr-evidence-missing");
    assertNotFound(result.status, result.body);
  });

  it("T04: wrong assessment id is cloaked as the same 404", async () => {
    await createReport();
    const foreign = await httpRequest(app)
      .get("/assessments/assessment-missing/evidence")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("x-correlation-id", "corr-evidence-foreign");
    assertNotFound(foreign.status, foreign.body);
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

  async function seedSystemAdmin(): Promise<string> {
    await prisma.user.create({
      data: {
        id: "user-evidence-systemAdmin",
        email: "evidence-system-admin@acme.test",
        passwordHash: hashSecret("SystemAdminPassword123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.admin,
      },
    });
    return signIn("evidence-system-admin@acme.test", "SystemAdminPassword123!");
  }

  async function createReport(
    overrides: {
      id?: string;
      status?: TechnicalEvidenceReportStatus;
      evidencePayload?: Prisma.InputJsonValue;
      configHash?: Prisma.InputJsonValue;
      createdAt?: Date;
    } = {},
  ): Promise<void> {
    const id = overrides.id ?? "report-evidence-1";
    await seedRepositoryScanGraph(prisma, {
      assessmentId: ASSESSMENT_ID,
      userId: "user-1",
      connectionId: `connection-${id}`,
      snapshotId: `snapshot-${id}`,
      scanJobId: `scan-job-${id}`,
    });
    await prisma.technicalEvidenceReport.create({
      data: {
        id,
        scanJobId: `scan-job-${id}`,
        assessmentId: ASSESSMENT_ID,
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
