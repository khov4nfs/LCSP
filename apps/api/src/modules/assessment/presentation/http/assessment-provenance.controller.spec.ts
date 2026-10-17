import { createHash, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  type AssessmentProvenanceArtifact,
  type AssessmentProvenanceExport,
} from "@lcsp/contracts/assessment-domain";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  HttpStatus,
  type ExecutionContext,
  type INestApplication,
} from "@nestjs/common";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { Test } from "@nestjs/testing";
import supertest from "supertest";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { AssessmentProvenanceLoader } from "../../infrastructure/persistence/assessment-provenance.loader.js";
import { AssessmentProvenanceController } from "./assessment-provenance.controller.js";

describe("AssessmentProvenanceController", () => {
  let app: INestApplication<Server>;
  let server: Server;

  const mockArtifact: AssessmentProvenanceArtifact = {
    schemaVersion: ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
    assessmentId: "11111111-1111-4111-8111-111111111111",
    name: "PCI-DSS Assessment",
    ownerId: "owner-1",
    generatedAt: new Date().toISOString(),
    correlationId: "corr-1",
    lifecycle: {
      state: "ACTIVE",
      assessmentRevision: 1,
    },
    pins: {
      ruleSet: {
        ruleSetVersionId: "rule-v1",
        version: "1.0.0",
        legalSourceVersion: "1.0",
        legalRequirementCount: 5,
        assessmentRuleCount: 10,
      },
      repositorySnapshotId: "snap-1",
      repositoryScanJobId: null,
      repositoryCommit: "abc1234",
      pinnedAt: new Date().toISOString(),
    },
    runtime: {
      threadId: "11111111-1111-4111-8111-111111111111",
      rootAgentVersion: "v1",
      checkpointNamespace: "11111111-1111-4111-8111-111111111111",
      checkpointId: null,
      currentExecutionId: null,
      executionState: "RUNNING",
      eventSequence: 1,
      startedAt: new Date().toISOString(),
      lastResumedAt: null,
      updatedAt: new Date().toISOString(),
    },
    acceptedFacts: [],
    acceptedEvidence: [],
    humanResolutions: [],
    decisions: [],
    coverage: [],
    events: [],
    artifacts: [],
    contentFingerprintSha256:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    checksumSha256:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };

  const loadProvenanceMock =
    jest.fn<(input: any) => Promise<AssessmentProvenanceArtifact>>();
  const auditWriteMock = jest.fn<(payload: any) => Promise<void>>();

  const actor = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    role: AUTH_USER_ROLES.customer,
    scope: null,
  };

  const assessmentId = "11111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AssessmentProvenanceController],
      providers: [
        {
          provide: AssessmentProvenanceLoader,
          useValue: { load: loadProvenanceMock },
        },
        {
          provide: AuditWriterService,
          useValue: { write: auditWriteMock },
        },
      ],
    })
      .overrideGuard(RbacGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          req.rbacContext = actor;
          req.correlationId = "corr-test-123";
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    loadProvenanceMock.mockReset();
    auditWriteMock.mockReset();
    loadProvenanceMock.mockResolvedValue(mockArtifact);
    auditWriteMock.mockResolvedValue(undefined);
  });

  it("GET /assessments/:id/provenance returns standard envelope with artifact and writes audit log", async () => {
    const response = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance`)
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      data: mockArtifact,
    });
    expect(loadProvenanceMock).toHaveBeenCalledWith({
      assessmentId,
      sessionUserId: actor.userId,
      subjectRole: actor.role,
      correlationId: "corr-test-123",
    });
    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assessment.provenance.viewed",
        assessmentId,
        actorId: actor.userId,
        result: "SUCCESS",
      }),
    );
  });

  it("GET /assessments/:id/provenance/download returns JSON file attachment and writes export audit log", async () => {
    const expectedExport: AssessmentProvenanceExport = {
      schemaVersion: mockArtifact.schemaVersion,
      assessmentId: mockArtifact.assessmentId,
      name: mockArtifact.name,
      ownerId: mockArtifact.ownerId,
      contentFingerprintSha256: mockArtifact.contentFingerprintSha256,
      checksumSha256: mockArtifact.checksumSha256,
      lifecycle: mockArtifact.lifecycle,
      pins: mockArtifact.pins,
      runtime: mockArtifact.runtime,
      acceptedFacts: mockArtifact.acceptedFacts,
      acceptedEvidence: mockArtifact.acceptedEvidence,
      humanResolutions: mockArtifact.humanResolutions,
      decisions: mockArtifact.decisions,
      coverage: mockArtifact.coverage,
      events: mockArtifact.events,
      artifacts: mockArtifact.artifacts,
    };
    const expectedExportBuffer = Buffer.from(
      JSON.stringify(expectedExport, null, 2),
      "utf8",
    );
    const expectedExportChecksum = createHash("sha256")
      .update(expectedExportBuffer)
      .digest("hex");

    const response = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance/download`)
      .expect(200);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="assessment-${assessmentId}-provenance.json"`,
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["etag"]).toBe(`"${expectedExportChecksum}"`);
    expect(response.headers["x-checksum-sha256"]).toBe(expectedExportChecksum);
    expect(response.headers["x-content-fingerprint-sha256"]).toBe(
      mockArtifact.contentFingerprintSha256,
    );

    const parsed = JSON.parse(response.text) as Record<string, unknown>;
    expect(parsed.assessmentId).toBe(assessmentId);
    expect(parsed.contentFingerprintSha256).toBe(
      mockArtifact.contentFingerprintSha256,
    );
    expect(parsed.checksumSha256).toBe(mockArtifact.contentFingerprintSha256);
    expect("generatedAt" in parsed).toBe(false);
    expect("correlationId" in parsed).toBe(false);

    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assessment.provenance.exported",
        assessmentId,
        actorId: actor.userId,
        result: "SUCCESS",
        payload: {
          contentFingerprintSha256: mockArtifact.contentFingerprintSha256,
          exportChecksumSha256: expectedExportChecksum,
          checksumSha256: expectedExportChecksum,
        },
      }),
    );
  });

  it("computes strong ETag and export checksum deterministically from the downloaded representation bytes", async () => {
    const res1 = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance/download`)
      .expect(200);

    const res2 = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance/download`)
      .expect(200);

    // Same canonical provenance state produces identical downloaded bytes and identical strong ETag
    expect(res1.text).toBe(res2.text);
    expect(res1.headers["etag"]).toBe(res2.headers["etag"]);

    // Documented export checksum can be recomputed from the downloaded representation bytes
    const computedHash = createHash("sha256")
      .update(Buffer.from(res1.text, "utf8"))
      .digest("hex");
    expect(`"${computedHash}"`).toBe(res1.headers["etag"]);
    expect(computedHash).toBe(res1.headers["x-checksum-sha256"]);
  });

  it("ensures strong ETag changes whenever exported representation bytes change", async () => {
    const res1 = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance/download`)
      .expect(200);

    const changedArtifact: AssessmentProvenanceArtifact = {
      ...mockArtifact,
      name: "Mutated Assessment Name",
      contentFingerprintSha256:
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      checksumSha256:
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    };
    loadProvenanceMock.mockResolvedValueOnce(changedArtifact);

    const res2 = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance/download`)
      .expect(200);

    expect(res2.text).not.toBe(res1.text);
    expect(res2.headers["etag"]).not.toBe(res1.headers["etag"]);

    const computedHash2 = createHash("sha256")
      .update(Buffer.from(res2.text, "utf8"))
      .digest("hex");
    expect(`"${computedHash2}"`).toBe(res2.headers["etag"]);
  });

  it("rejects invalid UUID parameter with 422 UNPROCESSABLE_ENTITY", async () => {
    await supertest(server)
      .get("/assessments/invalid-uuid/provenance")
      .expect(422);

    expect(loadProvenanceMock).not.toHaveBeenCalled();
  });

  it("audits denial with result DENIED and returns 404 when loader rejects foreign/nonexistent assessment", async () => {
    loadProvenanceMock.mockRejectedValue(
      problemException(ASSESSMENT_ERROR_CODES.notFound, "corr-test-123", {
        status: HttpStatus.NOT_FOUND,
      }),
    );

    const response = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance`)
      .expect(404);

    expect(response.body).toEqual({
      ok: false,
      problem: expect.objectContaining({
        code: ASSESSMENT_ERROR_CODES.notFound,
      }),
    });

    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assessment.provenance.viewed",
        assessmentId,
        actorId: actor.userId,
        decision: "DENY",
        result: "DENIED",
        payload: {
          reason: "ACCESS_DENIED_OR_NOT_FOUND",
        },
      }),
    );
  });

  it("audits download denial with result DENIED and returns 404 when loader rejects foreign/nonexistent assessment", async () => {
    loadProvenanceMock.mockRejectedValue(
      problemException(ASSESSMENT_ERROR_CODES.notFound, "corr-test-123", {
        status: HttpStatus.NOT_FOUND,
      }),
    );

    const response = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance/download`)
      .expect(404);

    expect(response.body).toEqual({
      ok: false,
      problem: expect.objectContaining({
        code: ASSESSMENT_ERROR_CODES.notFound,
      }),
    });

    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assessment.provenance.exported",
        assessmentId,
        actorId: actor.userId,
        decision: "DENY",
        result: "DENIED",
        payload: {
          reason: "ACCESS_DENIED_OR_NOT_FOUND",
        },
      }),
    );
  });

  it("audits integrity failure as FAILED with PROVENANCE_INTEGRITY_MISMATCH when loader rejects integrity (409)", async () => {
    loadProvenanceMock.mockRejectedValue(
      problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        "corr-test-123",
        { status: HttpStatus.CONFLICT },
      ),
    );

    const response = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance`)
      .expect(409);

    expect(response.body).toEqual({
      ok: false,
      problem: expect.objectContaining({
        code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
      }),
    });

    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assessment.provenance.viewed",
        assessmentId,
        actorId: actor.userId,
        decision: "DENY",
        result: "FAILED",
        payload: {
          reason: "PROVENANCE_INTEGRITY_MISMATCH",
        },
      }),
    );
  });

  it("audits download integrity failure as FAILED with PROVENANCE_INTEGRITY_MISMATCH (409)", async () => {
    loadProvenanceMock.mockRejectedValue(
      problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        "corr-test-123",
        { status: HttpStatus.CONFLICT },
      ),
    );

    const response = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance/download`)
      .expect(409);

    expect(response.body).toEqual({
      ok: false,
      problem: expect.objectContaining({
        code: ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
      }),
    });

    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assessment.provenance.exported",
        assessmentId,
        actorId: actor.userId,
        decision: "DENY",
        result: "FAILED",
        payload: {
          reason: "PROVENANCE_INTEGRITY_MISMATCH",
        },
      }),
    );
  });
});
