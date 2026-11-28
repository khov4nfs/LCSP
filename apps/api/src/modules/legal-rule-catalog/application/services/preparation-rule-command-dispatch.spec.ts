import { describe, expect, it, jest } from "@jest/globals";
import { PreparationRuleService } from "./preparation-rule.service.js";
import { ActivatePreparedRulesCommand } from "../commands/activate-prepared-rules/activate-prepared-rules.command.js";
import { ImportAssessmentRulesCommand } from "../commands/import-assessment-rules/import-assessment-rules.command.js";

describe("PreparationRuleService command dispatch", () => {
  it("sends typed activation and import commands through CQRS when Nest supplies handlers", async () => {
    // Why: Production must use the registered CQRS handlers rather than the direct-test fallback.
    // How: Give the facade its injected handlers and capture commands at the bus boundary.
    // Invariant: Admin actor and correlation ID cross that boundary unchanged.
    const execute = jest
      .fn<(command: unknown) => Promise<unknown>>()
      .mockResolvedValue({ ok: true });
    const service = new PreparationRuleService(
      {} as never,
      {} as never,
      {} as never,
      { execute } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const activationRequest = { results: [] } as never;
    const importRequest = { items: [] } as never;
    await service.activate("catalog", activationRequest, "admin", "cid-1");
    await service.importAssessmentRules(
      "catalog",
      importRequest,
      "admin",
      "cid-2",
    );
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      ActivatePreparedRulesCommand,
    );
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      actor: "admin",
      correlationId: "cid-1",
    });
    expect(execute.mock.calls[1]?.[0]).toBeInstanceOf(
      ImportAssessmentRulesCommand,
    );
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      actor: "admin",
      correlationId: "cid-2",
    });
  });
});
