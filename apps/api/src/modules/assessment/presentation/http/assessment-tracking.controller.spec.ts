import type { Server } from "node:http";
import {
  describe,
  expect,
  it,
  beforeEach,
  afterAll,
  beforeAll,
  jest,
} from "@jest/globals";
import {
  HttpStatus,
  type ExecutionContext,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import supertest from "supertest";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  TRACKING_ACTION_REASONS,
  TRACKING_TRUST_STATUSES,
  type CustomerTrackingPortfolio,
  type AdminTrackingOperational,
} from "@lcsp/contracts/assessment-domain";
import {
  RBAC_METADATA_KEY,
  type RbacMetadata,
} from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AssessmentTrackingLoader } from "../../infrastructure/persistence/assessment-tracking.loader.js";
import { AssessmentTrackingController } from "./assessment-tracking.controller.js";
import { AdminTrackingController } from "./admin-tracking.controller.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";

describe("AssessmentTrackingControllers", () => {
  let app: INestApplication<Server>;
  let server: Server;

  let currentRole: AuthUserRole = AUTH_USER_ROLES.customer;
  let currentUserId = "user-123";

  const mockPortfolio: CustomerTrackingPortfolio = {
    actions: [
      {
        requestId: "22222222-2222-4222-8222-222222222222",
        assessmentId: "11111111-1111-4111-8111-111111111111",
        assessmentName: "Auth Assessment",
        assessmentRuleId: "RULE-1",
        question: "Is MFA required?",
        unresolvedFact: "MFA policy",
        actionReason: TRACKING_ACTION_REASONS.HUMAN_FACT_REQUIRED,
        createdAt: new Date().toISOString(),
        destinationUrl:
          "/assessments/11111111-1111-4111-8111-111111111111/provenance",
      },
    ],
    changes: [],
    complianceSummary: {
      compliantCount: 5,
      nonCompliantCount: 1,
      notApplicableCount: 2,
      unresolvedCount: 0,
      totalRulesEvaluated: 8,
    },
    assessments: [
      {
        assessmentId: "11111111-1111-4111-8111-111111111111",
        name: "Auth Assessment",
        lifecycleState: "COMPLETE",
        executionState: "SUCCEEDED",
        repository: {
          name: "acme/auth",
          owner: "acme",
          pinnedCommit: "abc1234",
          latestCommit: "abc1234",
          isStale: false,
        },
        ruleSet: {
          ruleSetVersionId: "rule-v1",
          ruleSetName: "1.0.0",
          ruleSetVersion: "1.0.0",
          isCurrent: true,
        },
        trust: {
          isTrustworthy: true,
          trustStatus: TRACKING_TRUST_STATUSES.TRUSTED,
          reason: null,
        },
        compliance: {
          compliantCount: 5,
          nonCompliantCount: 1,
          notApplicableCount: 2,
          unresolvedCount: 0,
        },
        report: {
          hasFinalReport: true,
          finalReportArtifactId: "33333333-3333-4333-8333-333333333333",
          finalReportCreatedAt: new Date().toISOString(),
          isReady: true,
        },
        pendingActionCount: 1,
        updatedAt: new Date().toISOString(),
      },
    ],
    correlationId: "corr-1",
    generatedAt: new Date().toISOString(),
  };

  const mockOperational: AdminTrackingOperational = {
    platformHealth: {
      totalActiveAssessments: 10,
      totalFailedAssessments: 2,
      totalBlockedAssessments: 1,
      totalExecutionAnomalies: 2,
      totalUnreconciledUsageEvents: 0,
      totalUntrustedProjections: 1,
    },
    impactedAssessments: [],
    executionAnomalies: [],
    unreconciledUsage: [],
    untrustedProjections: [],
    correlationId: "corr-admin",
    generatedAt: new Date().toISOString(),
  };

  const loadCustomerPortfolio = jest
    .fn<AssessmentTrackingLoader["loadCustomerPortfolio"]>()
    .mockResolvedValue(mockPortfolio);

  const loadAdminOperational = jest
    .fn<AssessmentTrackingLoader["loadAdminOperational"]>()
    .mockResolvedValue(mockOperational);

  const trackingLoaderMock = {
    loadCustomerPortfolio,
    loadAdminOperational,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AssessmentTrackingController, AdminTrackingController],
      providers: [
        {
          provide: AssessmentTrackingLoader,
          useValue: trackingLoaderMock,
        },
      ],
    })
      .overrideGuard(RbacGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          req.correlationId = "test-corr-id";
          req.rbacContext = {
            userId: currentUserId,
            email: "test@example.com",
            role: currentRole,
            organizationId: "org-1",
            membershipStatus: "ACTIVE",
            resolvedFrom: "TEST",
          } as unknown as AuthenticatedRequest["rbacContext"];

          const handler = context.getHandler();
          const target = context.getClass();
          const metadata = (Reflect.getMetadata(RBAC_METADATA_KEY, handler) ||
            Reflect.getMetadata(RBAC_METADATA_KEY, target)) as
            RbacMetadata | undefined;
          if (
            metadata &&
            metadata.type === "roles" &&
            !metadata.roles.includes(currentRole)
          ) {
            return false;
          }
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    currentRole = AUTH_USER_ROLES.customer;
    currentUserId = "user-123";
    jest.clearAllMocks();
  });

  describe("GET /assessments/tracking/portfolio", () => {
    it("returns 200 with resultEnvelope when invoked by CUSTOMER", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      currentUserId = "cust-1";

      const res = await supertest(server)
        .get("/assessments/tracking/portfolio")
        .expect(HttpStatus.OK);

      expect(res.body).toEqual({
        ok: true,
        data: mockPortfolio,
      });

      expect(loadCustomerPortfolio).toHaveBeenCalledWith({
        sessionUserId: "cust-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "test-corr-id",
      });
    });

    it("returns 403 when invoked by ADMIN", async () => {
      currentRole = AUTH_USER_ROLES.admin;

      await supertest(server)
        .get("/assessments/tracking/portfolio")
        .expect(HttpStatus.FORBIDDEN);

      expect(loadCustomerPortfolio).not.toHaveBeenCalled();
    });
  });

  describe("GET /admin/tracking/operational", () => {
    it("returns 200 with resultEnvelope when invoked by ADMIN", async () => {
      currentRole = AUTH_USER_ROLES.admin;
      currentUserId = "admin-1";

      const res = await supertest(server)
        .get("/admin/tracking/operational")
        .expect(HttpStatus.OK);

      expect(res.body).toEqual({
        ok: true,
        data: mockOperational,
      });

      expect(loadAdminOperational).toHaveBeenCalledWith({
        sessionUserId: "admin-1",
        subjectRole: AUTH_USER_ROLES.admin,
        correlationId: "test-corr-id",
      });
    });

    it("returns 403 when invoked by CUSTOMER", async () => {
      currentRole = AUTH_USER_ROLES.customer;

      await supertest(server)
        .get("/admin/tracking/operational")
        .expect(HttpStatus.FORBIDDEN);

      expect(loadAdminOperational).not.toHaveBeenCalled();
    });
  });
});
