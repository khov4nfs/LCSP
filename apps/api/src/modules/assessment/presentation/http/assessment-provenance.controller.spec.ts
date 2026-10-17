import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  type AssessmentProvenanceArtifact,
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
import type { ExecutionContext, INestApplication } from "@nestjs/common";
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
    const response = await supertest(server)
      .get(`/assessments/${assessmentId}/provenance/download`)
      .expect(200);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="assessment-${assessmentId}-provenance.json"`,
    );
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["etag"]).toBe(`"${mockArtifact.checksumSha256}"`);

    const parsed = JSON.parse(response.text) as AssessmentProvenanceArtifact;
    expect(parsed.assessmentId).toBe(assessmentId);
    expect(parsed.checksumSha256).toBe(mockArtifact.checksumSha256);

    expect(auditWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assessment.provenance.exported",
        assessmentId,
        actorId: actor.userId,
        result: "SUCCESS",
      }),
    );
  });

  it("rejects invalid UUID parameter with 422 UNPROCESSABLE_ENTITY", async () => {
    await supertest(server)
      .get("/assessments/invalid-uuid/provenance")
      .expect(422);

    expect(loadProvenanceMock).not.toHaveBeenCalled();
  });
});
