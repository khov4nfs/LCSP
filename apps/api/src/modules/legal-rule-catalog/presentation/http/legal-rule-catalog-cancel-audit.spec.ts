import "reflect-metadata";
import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus } from "@nestjs/cqrs";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { CancelRuleSetPreparationCommand } from "../../../compliance-rule-set/application/commands/cancel-rule-set-preparation/cancel-rule-set-preparation.command.js";
import type { LegalRuleCatalogService } from "../../application/services/legal-rule-catalog.service.js";
import { PreparationRuleService } from "../../application/services/preparation-rule.service.js";
import { LegalRuleCatalogController } from "./legal-rule-catalog.controller.js";

describe("Selected-rule Admin cancellation audit actor", () => {
  it("passes the authenticated Admin ID to the durable cancellation command", async () => {
    const actorId = "b18b9f61-6a5e-4681-9003-27e06452243d";
    const runId = "1d671275-7058-420c-b9f3-b437feebf21a";
    const execute = jest.fn<CommandBus["execute"]>().mockResolvedValue({});
    const service = new PreparationRuleService(
      {
        preparationRuleResult: {
          findUnique: jest.fn(() => Promise.resolve({ id: "selected-result" })),
        },
      } as unknown as PrismaService,
      {} as ConstructorParameters<typeof PreparationRuleService>[1],
      {} as ConstructorParameters<typeof PreparationRuleService>[2],
      { execute } as unknown as CommandBus,
      {} as ConstructorParameters<typeof PreparationRuleService>[4],
      {} as ConstructorParameters<typeof PreparationRuleService>[5],
    );
    const controller = new LegalRuleCatalogController(
      {} as LegalRuleCatalogService,
      service,
    );
    const request = {
      rbacContext: { userId: actorId },
      correlationId: "cancel-audit-test",
    } as AuthenticatedRequest;

    await controller.cancel(runId, request);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      preparationRunId: runId,
      correlationId: "cancel-audit-test",
      actorId,
    } satisfies Partial<CancelRuleSetPreparationCommand>);
  });
});
