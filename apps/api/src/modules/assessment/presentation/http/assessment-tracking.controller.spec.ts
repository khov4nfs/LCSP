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
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_TRUST_STATUSES,
  type CustomerTrackingOverview,
  type CustomerTrackingObligationAssessments,
  type AdminTrackingOperational,
} from "@lcsp/contracts/assessment-domain";
import {
  RBAC_METADATA_KEY,
  type RbacMetadata,
} from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { HttpExceptionFilter } from "../../../../platform/http/filters/http-exception.filter.js";
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

  const mockOverview: CustomerTrackingOverview = {
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
          "/assessments/11111111-1111-4111-8111-111111111111?requestId=22222222-2222-4222-8222-222222222222",
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
          observedAt: "2026-10-22T00:00:00.000Z",
          freshnessStatus: TRACKING_FRESHNESS_STATUSES.CURRENT,
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
    pagination: {
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    },
    actionsPagination: {
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    },
    changesPagination: {
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    },
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

  const mockObligationAssessments: CustomerTrackingObligationAssessments = {
    items: [],
    pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
    generatedAt: new Date().toISOString(),
  };

  const loadCustomerOverview = jest
    .fn<AssessmentTrackingLoader["loadCustomerOverview"]>()
    .mockResolvedValue(mockOverview);

  const loadAdminOperational = jest
    .fn<AssessmentTrackingLoader["loadAdminOperational"]>()
    .mockResolvedValue(mockOperational);

  const loadCustomerObligationAssessments = jest
    .fn<AssessmentTrackingLoader["loadCustomerObligationAssessments"]>()
    .mockResolvedValue(mockObligationAssessments);

  const trackingLoaderMock = {
    loadCustomerOverview,
    loadCustomerObligationAssessments,
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
    app.useGlobalFilters(new HttpExceptionFilter());
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

  describe("GET /assessments/tracking/overview", () => {
    it("returns 200 with resultEnvelope when invoked by CUSTOMER", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      currentUserId = "cust-1";

      const res = await supertest(server)
        .get("/assessments/tracking/overview")
        .expect(HttpStatus.OK);

      expect(res.body).toEqual({
        ok: true,
        data: mockOverview,
      });

      expect(loadCustomerOverview).toHaveBeenCalledWith({
        sessionUserId: "cust-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "test-corr-id",
        limit: undefined,
        offset: undefined,
        actionsLimit: undefined,
        actionsOffset: undefined,
        changesLimit: undefined,
        changesOffset: undefined,
        since: undefined,
        locale: undefined,
      });
    });

    it("parses and forwards actions and changes pagination query params", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      currentUserId = "cust-1";

      const res = await supertest(server)
        .get(
          "/assessments/tracking/overview?limit=10&offset=5&actionsLimit=20&actionsOffset=10&changesLimit=30&changesOffset=15",
        )
        .expect(HttpStatus.OK);

      expect(res.body).toEqual({
        ok: true,
        data: mockOverview,
      });

      expect(loadCustomerOverview).toHaveBeenCalledWith({
        sessionUserId: "cust-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "test-corr-id",
        limit: 10,
        offset: 5,
        actionsLimit: 20,
        actionsOffset: 10,
        changesLimit: 30,
        changesOffset: 15,
        since: undefined,
        locale: undefined,
      });
    });

    it("returns 403 when invoked by ADMIN", async () => {
      currentRole = AUTH_USER_ROLES.admin;

      await supertest(server)
        .get("/assessments/tracking/overview")
        .expect(HttpStatus.FORBIDDEN);

      expect(loadCustomerOverview).not.toHaveBeenCalled();
    });

    it("rejects non-integer, negative, or invalid pagination and timestamp with 400", async () => {
      currentRole = AUTH_USER_ROLES.customer;

      const resFloat = await supertest(server)
        .get("/assessments/tracking/overview?offset=1.5")
        .expect(HttpStatus.BAD_REQUEST);
      expect((resFloat.body as Record<string, unknown>).ok).toBe(false);

      const resInfinity = await supertest(server)
        .get("/assessments/tracking/overview?offset=Infinity")
        .expect(HttpStatus.BAD_REQUEST);
      expect((resInfinity.body as Record<string, unknown>).ok).toBe(false);

      const resNegative = await supertest(server)
        .get("/assessments/tracking/overview?offset=-1")
        .expect(HttpStatus.BAD_REQUEST);
      expect((resNegative.body as Record<string, unknown>).ok).toBe(false);

      const resNan = await supertest(server)
        .get("/assessments/tracking/overview?offset=NaN")
        .expect(HttpStatus.BAD_REQUEST);
      expect((resNan.body as Record<string, unknown>).ok).toBe(false);

      const resSinceGarbage = await supertest(server)
        .get("/assessments/tracking/overview?since=garbage")
        .expect(HttpStatus.BAD_REQUEST);
      expect((resSinceGarbage.body as Record<string, unknown>).ok).toBe(false);

      const resLimitZero = await supertest(server)
        .get("/assessments/tracking/overview?limit=0")
        .expect(HttpStatus.BAD_REQUEST);
      expect((resLimitZero.body as Record<string, unknown>).ok).toBe(false);

      const resLimitOver = await supertest(server)
        .get("/assessments/tracking/overview?limit=101")
        .expect(HttpStatus.BAD_REQUEST);
      expect((resLimitOver.body as Record<string, unknown>).ok).toBe(false);

      expect(loadCustomerOverview).not.toHaveBeenCalled();
    });

    it("accepts valid ISO datetime since parameter and forwards it", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      currentUserId = "cust-1";

      const validSince = "2026-10-20T14:00:00.000Z";
      const res = await supertest(server)
        .get(
          `/assessments/tracking/overview?since=${encodeURIComponent(validSince)}`,
        )
        .expect(HttpStatus.OK);

      expect((res.body as Record<string, unknown>).ok).toBe(true);
      expect(loadCustomerOverview).toHaveBeenCalledWith(
        expect.objectContaining({
          since: validSince,
        }),
      );
    });
  });

  describe("GET /assessments/tracking/obligations/assessments", () => {
    it("validates the group key, forwards pagination, and returns the shared envelope for CUSTOMER", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      currentUserId = "cust-1";
      const res = await supertest(server)
        .get(
          "/assessments/tracking/obligations/assessments?ruleSetVersionId=00000000-0000-4000-8000-000000000001&assessmentRuleId=RULE-MFA&limit=20&offset=20",
        )
        .expect(HttpStatus.OK);
      expect(res.body).toEqual({ ok: true, data: mockObligationAssessments });
      expect(loadCustomerObligationAssessments).toHaveBeenCalledWith({
        sessionUserId: "cust-1",
        subjectRole: AUTH_USER_ROLES.customer,
        ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
        assessmentRuleId: "RULE-MFA",
        limit: 20,
        offset: 20,
        outcome: undefined,
        freshness: undefined,
      });
    });

    it("rejects CUSTOMER/ADMIN authorization violations and malformed obligation identifiers", async () => {
      currentRole = AUTH_USER_ROLES.admin;
      await supertest(server)
        .get(
          "/assessments/tracking/obligations/assessments?ruleSetVersionId=00000000-0000-4000-8000-000000000001&assessmentRuleId=RULE-MFA",
        )
        .expect(HttpStatus.FORBIDDEN);
      expect(loadCustomerObligationAssessments).not.toHaveBeenCalled();

      currentRole = AUTH_USER_ROLES.customer;
      const invalid = await supertest(server)
        .get(
          "/assessments/tracking/obligations/assessments?ruleSetVersionId=invalid&assessmentRuleId=RULE-MFA",
        )
        .expect(HttpStatus.BAD_REQUEST);
      expect((invalid.body as Record<string, unknown>).ok).toBe(false);
      expect(loadCustomerObligationAssessments).not.toHaveBeenCalled();
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
