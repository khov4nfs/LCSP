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
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import supertest from "supertest";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_RUNTIME_CONTROL_STATES,
  type AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";
import {
  RBAC_METADATA_KEY,
  type RbacMetadata,
} from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { HttpExceptionFilter } from "../../../../platform/http/filters/http-exception.filter.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { AssessmentRuntimeControlController } from "./assessment-runtime-control.controller.js";
import { AdminAssessmentBudgetController } from "./admin-assessment-budget.controller.js";

describe("AssessmentRuntimeControl Controllers RBAC and Workflows", () => {
  let app: INestApplication<Server>;
  let server: Server;

  let currentRole: AuthUserRole | null = AUTH_USER_ROLES.customer;
  let currentUserId = "user-customer";

  const assessmentId = "11111111-1111-4111-8111-111111111111";
  const targetRunId = "22222222-2222-4222-8222-222222222222";

  const mockControlResult: AssessmentRuntimeControlResult = {
    state: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
    targetRunId,
    requestId: "33333333-3333-4333-8333-333333333333",
  };

  const commandBusMock = {
    execute: jest
      .fn<(command?: any) => Promise<any>>()
      .mockResolvedValue(mockControlResult),
  };

  const queryBusMock = {
    execute: jest
      .fn<(query?: any) => Promise<any>>()
      .mockResolvedValue(mockControlResult),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AssessmentRuntimeControlController,
        AdminAssessmentBudgetController,
      ],
      providers: [
        { provide: CommandBus, useValue: commandBusMock },
        { provide: QueryBus, useValue: queryBusMock },
      ],
    })
      .overrideGuard(RbacGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          req.correlationId = "test-corr-id";
          if (!currentRole) {
            return false;
          }
          // Why: Active authorization uses RBAC with `{ userId, sessionId, role, scope }` only (no PBAC/org).
          req.rbacContext = {
            userId: currentUserId,
            sessionId: "test-session-id",
            role: currentRole,
            scope: null,
          };

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
    jest.clearAllMocks();
    currentRole = AUTH_USER_ROLES.customer;
    currentUserId = "user-customer";
  });

  describe("GET /assessments/:assessmentId/runtime/control", () => {
    it("allows customer to read runtime control state", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      const res = await supertest(server).get(
        `/assessments/${assessmentId}/runtime/control`,
      );
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toEqual({ ok: true, data: mockControlResult });
    });

    it("allows admin to read runtime control state", async () => {
      currentRole = AUTH_USER_ROLES.admin;
      currentUserId = "user-admin";
      const res = await supertest(server).get(
        `/assessments/${assessmentId}/runtime/control`,
      );
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toMatchObject({ ok: true });
    });

    it("rejects unauthenticated/unauthorized users", async () => {
      currentRole = null;
      const res = await supertest(server).get(
        `/assessments/${assessmentId}/runtime/control`,
      );
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe("POST /assessments/:assessmentId/runtime/stop", () => {
    it("allows customer to stop runtime execution", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      const res = await supertest(server)
        .post(`/assessments/${assessmentId}/runtime/stop`)
        .send({ targetRunId });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(commandBusMock.execute).toHaveBeenCalled();
    });

    it("rejects admin from invoking customer stop", async () => {
      currentRole = AUTH_USER_ROLES.admin;
      const res = await supertest(server)
        .post(`/assessments/${assessmentId}/runtime/stop`)
        .send({ targetRunId });
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe("POST /assessments/:assessmentId/runtime/continue", () => {
    it("allows customer to resume runtime execution without budget extension", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      const res = await supertest(server)
        .post(`/assessments/${assessmentId}/runtime/continue`)
        .send({ targetRunId });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(commandBusMock.execute).toHaveBeenCalled();
    });

    it("rejects customer attempting to supply budgetExtension on continue", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      const res = await supertest(server)
        .post(`/assessments/${assessmentId}/runtime/continue`)
        .send({
          targetRunId,
          budgetExtension: {
            version: 1,
            additionalModelCalls: 10,
          },
        });
      expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it("rejects admin from invoking customer continue endpoint", async () => {
      currentRole = AUTH_USER_ROLES.admin;
      const res = await supertest(server)
        .post(`/assessments/${assessmentId}/runtime/continue`)
        .send({ targetRunId });
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe("POST /assessments/:assessmentId/runtime/extend-budget", () => {
    const validExtension = {
      targetRunId,
      idempotencyKey: "idem-legacy-1",
      expectedVersion: 0,
      budgetExtension: {
        version: 1,
        additionalModelCalls: 50,
        additionalTotalTokens: 500_000,
        auditReason: "Approved higher quota by security lead",
      },
    };

    it("allows admin to approve and submit budget extension with Deprecation: true header", async () => {
      currentRole = AUTH_USER_ROLES.admin;
      currentUserId = "user-admin";
      const res = await supertest(server)
        .post(`/assessments/${assessmentId}/runtime/extend-budget`)
        .send(validExtension);
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.headers.deprecation).toBe("true");
      expect(commandBusMock.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId,
          targetRunId,
          idempotencyKey: "idem-legacy-1",
          expectedVersion: 0,
          budgetExtension: validExtension.budgetExtension,
        }),
      );
    });

    it("rejects customer from calling administrative extend-budget", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      const res = await supertest(server)
        .post(`/assessments/${assessmentId}/runtime/extend-budget`)
        .send(validExtension);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe("POST /admin/assessments/:assessmentId/budget-extension", () => {
    const validExtension = {
      targetRunId,
      idempotencyKey: "idem-admin-1",
      expectedVersion: 0,
      budgetExtension: {
        version: 1,
        additionalModelCalls: 25,
        auditReason: "Admin unblock override",
      },
    };

    it("allows admin to approve budget extension via dedicated admin route and forwards idempotencyKey + expectedVersion", async () => {
      currentRole = AUTH_USER_ROLES.admin;
      currentUserId = "user-admin";
      const res = await supertest(server)
        .post(`/admin/assessments/${assessmentId}/budget-extension`)
        .send(validExtension);
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(commandBusMock.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId,
          targetRunId,
          idempotencyKey: "idem-admin-1",
          expectedVersion: 0,
          budgetExtension: validExtension.budgetExtension,
        }),
      );
    });

    it("forwards identical ControlAssessmentRuntimeCommand from canonical admin route and deprecated legacy route", async () => {
      currentRole = AUTH_USER_ROLES.admin;
      currentUserId = "user-admin";
      const sharedPayload = {
        targetRunId,
        idempotencyKey: "idem-parity-1",
        expectedVersion: 1,
        budgetExtension: {
          version: 2,
          additionalModelCalls: 40,
          auditReason: "Command parity check",
        },
      };

      const adminRes = await supertest(server)
        .post(`/admin/assessments/${assessmentId}/budget-extension`)
        .set("x-lcsp-locale", "vi")
        .send(sharedPayload);
      const legacyRes = await supertest(server)
        .post(`/assessments/${assessmentId}/runtime/extend-budget`)
        .set("x-lcsp-locale", "vi")
        .send(sharedPayload);

      expect(adminRes.status).toBe(HttpStatus.CREATED);
      expect(legacyRes.status).toBe(HttpStatus.CREATED);
      expect(legacyRes.headers.deprecation).toBe("true");
      expect(commandBusMock.execute).toHaveBeenCalledTimes(2);
      const adminCommand = (
        commandBusMock.execute.mock.calls[0] as unknown[]
      )[0];
      const legacyCommand = (
        commandBusMock.execute.mock.calls[1] as unknown[]
      )[0];
      expect(legacyCommand).toEqual(adminCommand);
      expect(adminCommand).toEqual(
        expect.objectContaining({
          assessmentId,
          targetRunId,
          idempotencyKey: "idem-parity-1",
          expectedVersion: 1,
          responseLanguage: "vi",
          budgetExtension: sharedPayload.budgetExtension,
        }),
      );
    });

    it("rejects customer from accessing dedicated admin budget extension route", async () => {
      currentRole = AUTH_USER_ROLES.customer;
      const res = await supertest(server)
        .post(`/admin/assessments/${assessmentId}/budget-extension`)
        .send(validExtension);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });
});
