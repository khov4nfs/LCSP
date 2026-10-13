import type { Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { COMPLIANCE_RULE_SET_ERROR_CODES } from "@lcsp/contracts/compliance-rule-set";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Test } from "@nestjs/testing";
import supertest from "supertest";
import { Session } from "../../../auth/domain/entities/session.entity.js";
import { User } from "../../../auth/domain/entities/user.entity.js";
import type { RbacContextLoader } from "../../../../platform/rbac/rbac-context.loader.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { PrepareCurrentRuleSetCommand } from "../../application/commands/prepare-current-rule-set/prepare-current-rule-set.command.js";
import { RetryRuleSetPreparationCommand } from "../../application/commands/retry-rule-set-preparation/retry-rule-set-preparation.command.js";
import { ComplianceRuleSetAdminController } from "./compliance-rule-set-admin.controller.js";

describe("Admin preparation HTTP authorization and command boundary", () => {
  let app: INestApplication<Server>;
  const execute = jest.fn<CommandBus["execute"]>().mockResolvedValue({
    preparationRunId: "31e042e8-6b91-4bfd-8853-108bb4436efd",
    legalSourceVersionId: "5ae8f595-1ae6-44a4-b7c1-ef9d4da37598",
    executionState: AGENT_EXECUTION_STATES.QUEUED,
    ruleSetVersionId: null,
  });
  beforeAll(async () => {
    const loader = {
      load: (token: string) =>
        Promise.resolve({
          ok: true,
          session: Session.rehydrate({
            id: "session",
            userId: "owner-admin",
            tokenHash: "test-hash",
            expiresAt: Date.now() + 60_000,
          }),
          user: User.rehydrate({
            id: "owner-admin",
            email: "admin@example.test",
            passwordHash: "test-hash",
            emailVerified: true,
            failedLoginCount: 0,
            role:
              token === "admin"
                ? AUTH_USER_ROLES.admin
                : AUTH_USER_ROLES.customer,
          }),
        }),
    } as unknown as RbacContextLoader;
    const guard = new RbacGuard(new Reflector(), loader, {
      append: async () => {},
    });
    const module = await Test.createTestingModule({
      controllers: [ComplianceRuleSetAdminController],
      providers: [
        { provide: CommandBus, useValue: { execute } },
        { provide: QueryBus, useValue: { execute: jest.fn() } },
      ],
    })
      .overrideGuard(RbacGuard)
      .useValue(guard)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    execute.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });

  it("ADMIN starts preparation with server-owned actor and no content input", async () => {
    const response = await supertest(app.getHttpServer())
      .post("/admin/compliance-rule-sets/prepare")
      .set("Authorization", "Bearer admin")
      .expect(202);
    expect(response.body).toMatchObject({
      ok: true,
      data: { executionState: AGENT_EXECUTION_STATES.QUEUED },
    });
    const dispatched = execute.mock.calls[0][0] as PrepareCurrentRuleSetCommand;
    expect(dispatched).toBeInstanceOf(PrepareCurrentRuleSetCommand);
    expect(dispatched.requestedBy).toBe("owner-admin");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("non-admin receives canonical 403 and cannot dispatch preparation", async () => {
    const response = await supertest(app.getHttpServer())
      .post("/admin/compliance-rule-sets/prepare")
      .set("Authorization", "Bearer customer")
      .expect(403);
    expect(response.body).toMatchObject({
      ok: false,
      problem: { code: AUTH_ERROR_CODES.rbacDenied, status: 403 },
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    await supertest(app.getHttpServer())
      .post("/admin/compliance-rule-sets/prepare")
      .expect(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects caller-selected source, identity or generated content", async () => {
    const response = await supertest(app.getHttpServer())
      .post("/admin/compliance-rule-sets/prepare")
      .set("Authorization", "Bearer admin")
      .send({
        legalSourceVersionId: "fixture",
        requestedBy: "attacker",
        packet: {},
      })
      .expect(400);
    expect(response.body).toMatchObject({
      ok: false,
      problem: {
        code: COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
        status: 400,
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("Retry still dispatches the existing canonical retry command", async () => {
    const id = "31e042e8-6b91-4bfd-8853-108bb4436efd";
    await supertest(app.getHttpServer())
      .post(`/admin/compliance-rule-sets/preparations/${id}/retries`)
      .set("Authorization", "Bearer admin")
      .expect(202);
    const dispatched = execute.mock
      .calls[0][0] as RetryRuleSetPreparationCommand;
    expect(dispatched).toBeInstanceOf(RetryRuleSetPreparationCommand);
    expect(dispatched.preparationRunId).toBe(id);
  });
});
