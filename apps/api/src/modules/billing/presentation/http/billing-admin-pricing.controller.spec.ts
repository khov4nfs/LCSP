import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import {
  RBAC_METADATA_KEY,
  type RbacMetadata,
} from "../../../../platform/rbac/decorators/rbac-metadata.js";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { BillingAdminPricingController } from "./billing-admin-pricing.controller.js";

describe("BillingAdminPricingController", () => {
  const adminReq = {
    correlationId: "corr-ctrl-1",
    rbacContext: {
      userId: "admin-actor-99",
      sessionId: "sess-1",
      role: AUTH_USER_ROLES.admin,
      scope: "GLOBAL",
    },
  } as unknown as AuthenticatedRequest;

  it("enforces Admin RBAC metadata at controller level", () => {
    const rbacMeta = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      BillingAdminPricingController,
    ) as RbacMetadata | undefined;
    expect(rbacMeta).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.admin],
    });
  });

  it("wraps query and command outputs in { ok: true, data } and derives actorId solely from rbacContext", async () => {
    const executeCommand = jest.fn<
      (command: unknown) => Promise<{ id: string }>
    >(() => Promise.resolve({ id: "draft-1" }));
    const executeQuery = jest.fn<
      (query: unknown) => Promise<{ debitMode: string }>
    >(() => Promise.resolve({ debitMode: MODEL_USAGE_DEBIT_MODES.OFF }));
    const controller = new BillingAdminPricingController(
      { execute: executeCommand } as unknown as CommandBus,
      { execute: executeQuery } as unknown as QueryBus,
    );

    const overviewRes = await controller.getOverview({}, adminReq);
    expect(overviewRes).toEqual({
      ok: true,
      data: { debitMode: MODEL_USAGE_DEBIT_MODES.OFF },
    });

    const createRes = await controller.createDraft(
      {
        scope: MODEL_PRICING_SCOPES.globalDefault,
        inputMicrocreditsPerMillion: "1000000",
        outputMicrocreditsPerMillion: "2000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      },
      adminReq,
    );
    expect(createRes).toEqual({ ok: true, data: { id: "draft-1" } });
    expect(executeCommand).toHaveBeenCalledTimes(1);
    const dispatchedCmd = executeCommand.mock.calls[0]?.[0] as {
      input: { actorId: string; correlationId: string };
    };
    expect(dispatchedCmd.input.actorId).toBe("admin-actor-99");
    expect(dispatchedCmd.input.correlationId).toBe("corr-ctrl-1");
  });
});
