import { ResumeRuleSetPreparationCommand } from "../../application/commands/resume-rule-set-preparation/resume-rule-set-preparation.command.js";
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
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_REACTIVATION_REASONS,
} from "@lcsp/contracts/compliance-rule-set";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Test } from "@nestjs/testing";
import supertest from "supertest";
import { Session } from "../../../auth/domain/entities/session.entity.js";
import { User } from "../../../auth/domain/entities/user.entity.js";
import type { RbacContextLoader } from "../../../../platform/rbac/rbac-context.loader.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { CancelRuleSetPreparationCommand } from "../../application/commands/cancel-rule-set-preparation/cancel-rule-set-preparation.command.js";
import { PrepareCurrentRuleSetCommand } from "../../application/commands/prepare-current-rule-set/prepare-current-rule-set.command.js";
import { RetryRuleSetPreparationCommand } from "../../application/commands/retry-rule-set-preparation/retry-rule-set-preparation.command.js";
import { ComplianceRuleSetAdminController } from "./compliance-rule-set-admin.controller.js";
import { ReactivateComplianceRuleSetCommand } from "../../application/commands/reactivate-compliance-rule-set/reactivate-compliance-rule-set.command.js";

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

  it("ADMIN resumes the same preparation through the canonical envelope", async () => {
    const id = "31e042e8-6b91-4bfd-8853-108bb4436efd";
    const response = await supertest(app.getHttpServer())
      .post(`/admin/compliance-rule-sets/preparations/${id}/resume`)
      .set("Authorization", "Bearer admin")
      .expect(202);
    expect(response.body).toMatchObject({
      ok: true,
      data: { preparationRunId: id },
    });
    expect(execute.mock.calls[0][0]).toBeInstanceOf(
      ResumeRuleSetPreparationCommand,
    );
    expect(execute.mock.calls[0][0]).toMatchObject({
      preparationRunId: id,
      requestedBy: "owner-admin",
    });
  });
  it.each(["customer", null])(
    "non-admin %s cannot resume a preparation",
    async (actor) => {
      const request = supertest(app.getHttpServer()).post(
        "/admin/compliance-rule-sets/preparations/31e042e8-6b91-4bfd-8853-108bb4436efd/resume",
      );
      if (actor) request.set("Authorization", `Bearer ${actor}`);
      await request.expect(actor ? 403 : 401);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  const target = "30f83523-f8a4-40d9-ab8f-3c4e878d8c60";
  const reactivation = {
    expectedActiveRuleSetVersionId: "43eaa343-9fbe-40ef-a6a9-935249bbcb1e",
    idempotencyKey: "test-reactivation",
    reason: RULE_SET_REACTIVATION_REASONS.SEMANTIC_AUTHORITY_CONTAINMENT,
  };
  it("ADMIN dispatches explicit reactivation with authenticated actor", async () => {
    await supertest(app.getHttpServer())
      .post(`/admin/compliance-rule-sets/${target}/reactivate`)
      .set("Authorization", "Bearer admin")
      .send(reactivation)
      .expect(200);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBeInstanceOf(
      ReactivateComplianceRuleSetCommand,
    );
    expect(execute.mock.calls[0][0]).toMatchObject({
      targetRuleSetVersionId: target,
      actorId: "owner-admin",
      request: reactivation,
    });
  });
  it("customer cannot reactivate", async () => {
    await supertest(app.getHttpServer())
      .post(`/admin/compliance-rule-sets/${target}/reactivate`)
      .set("Authorization", "Bearer customer")
      .send(reactivation)
      .expect(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it("missing actor cannot reactivate", async () => {
    await supertest(app.getHttpServer())
      .post(`/admin/compliance-rule-sets/${target}/reactivate`)
      .send(reactivation)
      .expect(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    { ...reactivation, expectedActiveRuleSetVersionId: "bad" },
    { ...reactivation, status: "ACTIVE" },
    { ...reactivation, actorId: "attacker" },
  ])(
    "rejects malformed or generic status/actor mutation input %#",
    async (body) => {
      await supertest(app.getHttpServer())
        .post(`/admin/compliance-rule-sets/${target}/reactivate`)
        .set("Authorization", "Bearer admin")
        .send(body)
        .expect(400);
      expect(execute).not.toHaveBeenCalled();
    },
  );
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

  it("ADMIN cancels by canonical preparation ID without supplying runtime identity", async () => {
    const id = "31e042e8-6b91-4bfd-8853-108bb4436efd";
    await supertest(app.getHttpServer())
      .post(`/admin/compliance-rule-sets/preparations/${id}/cancel`)
      .set("Authorization", "Bearer admin")
      .expect(202);
    const dispatched = execute.mock
      .calls[0][0] as CancelRuleSetPreparationCommand;
    expect(dispatched).toBeInstanceOf(CancelRuleSetPreparationCommand);
    expect(dispatched.preparationRunId).toBe(id);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("non-admin cannot cancel a preparation", async () => {
    const id = "31e042e8-6b91-4bfd-8853-108bb4436efd";
    const response = await supertest(app.getHttpServer())
      .post(`/admin/compliance-rule-sets/preparations/${id}/cancel`)
      .set("Authorization", "Bearer customer")
      .expect(403);
    expect(response.body).toMatchObject({
      ok: false,
      problem: { code: AUTH_ERROR_CODES.rbacDenied, status: 403 },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
