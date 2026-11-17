import "reflect-metadata";
import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES, AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { customerUsageQuerySchema } from "@lcsp/contracts/billing";
import { CustomerUsageController } from "../src/modules/billing/presentation/http/customer-usage.controller.js";
import { GetCustomerUsageHandler } from "../src/modules/billing/application/queries/get-customer-usage/get-customer-usage.handler.js";
import { GetCustomerUsageQuery } from "../src/modules/billing/application/queries/get-customer-usage/get-customer-usage.query.js";
import { RBAC_METADATA_KEY } from "../src/platform/rbac/decorators/rbac-metadata.js";
import { RbacGuard } from "../src/platform/rbac/rbac.guard.js";
import { Session } from "../src/modules/auth/domain/entities/session.entity.js";
import { User } from "../src/modules/auth/domain/entities/user.entity.js";

describe("Customer Usage owner boundary", () => {
  it("the real RBAC guard rejects missing tokens/wrong roles and supplies the accepted owner", async () => {
    for (const role of [AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin]) {
      const session = Session.rehydrate({
        id: "session-a",
        userId: "owner-a",
        tokenHash: "test",
        expiresAt: Date.now() + 60000,
      });
      const user = User.rehydrate({
        id: "owner-a",
        email: "owner-a@test.invalid",
        passwordHash: "test",
        failedLoginCount: 0,
        emailVerified: true,
        role,
      });
      const guard = new RbacGuard(
        new Reflector(),
        { load: () => Promise.resolve({ ok: true, session, user }) } as never,
        { append: () => Promise.resolve() },
      );
      const request = {
        headers: {},
        params: {},
        method: "GET",
        route: { path: "/billing/usage" },
        rbacContext: undefined,
      };
      const context = {
        getClass: () => CustomerUsageController,
        getHandler: () => Reflect.get(CustomerUsageController.prototype, "get"),
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 401,
      });
      request.headers = { authorization: "Bearer test-session" };
      if (role === AUTH_USER_ROLES.customer) {
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request.rbacContext).toMatchObject({ userId: "owner-a", role });
      } else {
        await expect(guard.canActivate(context)).rejects.toMatchObject({
          status: 403,
          response: { problem: { code: AUTH_ERROR_CODES.rbacDenied } },
        });
      }
    }
  });
  it("requires the customer role and derives the owner from the request context", async () => {
    expect(
      Reflect.getMetadata(RBAC_METADATA_KEY, CustomerUsageController),
    ).toMatchObject({ roles: [AUTH_USER_ROLES.customer] });
    const execute = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ items: [] });
    const controller = new CustomerUsageController({ execute } as never);
    await expect(
      controller.get(customerUsageQuerySchema.parse({}), {
        rbacContext: { userId: "owner-a" },
      } as never),
    ).resolves.toMatchObject({ ok: true, data: { items: [] } });
    expect(execute.mock.calls[0][0]).toMatchObject({ userId: "owner-a" });
  });

  it("fails closed for missing owners and forged internal filters before reading", async () => {
    const read = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    const handler = new GetCustomerUsageHandler({ read } as never);
    await expect(
      handler.execute(
        new GetCustomerUsageQuery("", customerUsageQuerySchema.parse({})),
      ),
    ).rejects.toThrow();
    await expect(
      handler.execute(
        new GetCustomerUsageQuery("owner-a", { userId: "owner-b" } as never),
      ),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
