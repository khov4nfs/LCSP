import { describe, expect, it, jest } from "@jest/globals";
import { billingLlmUsageReportSchema } from "@lcsp/contracts/billing";
import { RecordLlmUsageCommand } from "../src/modules/billing/application/commands/record-llm-usage/record-llm-usage.command.js";
import { ResolveBillingAssessmentOwnerQuery } from "../src/modules/billing/application/queries/resolve-billing-assessment-owner/resolve-billing-assessment-owner.query.js";
import { OwnershipMismatchError } from "../src/modules/billing/domain/billing.errors.js";
import { BillingUsageController } from "../src/modules/billing/presentation/http/billing-usage.controller.js";

/** The worker's exact payload: no reservation, price or charge. */
const WORKER_PAYLOAD = {
  assessmentId: "assessment-1",
  runId: "run-1",
  invocationId: "inv-1",
  agentRole: "root",
  provider: "llm7",
  model: "Brand-New-Model-9000",
  effectiveRuntimeModel: {
    provider: "LLM7",
    model: "Brand-New-Model-9000",
    policyVersion: "cfg-0123456789abcdef",
    effectiveAt: "1970-01-01T00:00:00.000Z",
  },
  inputTokens: "120",
  outputTokens: "30",
  occurredAt: "2026-10-01T00:00:00.000Z",
};

describe("internal billing usage endpoint", () => {
  it("accepts the worker payload with no reservationId and omitted optional tokens", () => {
    const parsed = billingLlmUsageReportSchema.safeParse(WORKER_PAYLOAD);
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("reservationId");
    expect(parsed.data).not.toHaveProperty("cachedInputTokens");
  });

  it("rejects a runtime policy whose model differs from the reported model", () => {
    const parsed = billingLlmUsageReportSchema.safeParse({
      ...WORKER_PAYLOAD,
      effectiveRuntimeModel: {
        ...WORKER_PAYLOAD.effectiveRuntimeModel,
        model: "another-model",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("resolves the owner from the assessment and records tokens only", async () => {
    const queryBus = {
      execute: jest
        .fn<(query: unknown) => Promise<string>>()
        .mockResolvedValue("owner-1"),
    };
    const commandBus = {
      execute: jest
        .fn<(command: unknown) => Promise<unknown>>()
        .mockResolvedValue({ id: "usage-1", inputTokens: 120n }),
    };
    const controller = new BillingUsageController(
      commandBus as never,
      queryBus as never,
    );

    const body = billingLlmUsageReportSchema.parse(WORKER_PAYLOAD);
    await expect(controller.recordUsage(body)).resolves.toEqual({
      ok: true,
      data: { id: "usage-1", inputTokens: "120" },
    });

    expect(queryBus.execute).toHaveBeenCalledWith(
      new ResolveBillingAssessmentOwnerQuery("assessment-1"),
    );
    const command = commandBus.execute.mock
      .calls[0][0] as RecordLlmUsageCommand;
    expect(command).toBeInstanceOf(RecordLlmUsageCommand);
    expect(command.input).toMatchObject({
      userId: "owner-1",
      provider: "LLM7",
      model: "Brand-New-Model-9000",
      inputTokens: 120n,
      outputTokens: 30n,
    });
    expect(command.input.cachedInputTokens).toBeUndefined();
    expect(Object.keys(command.input)).not.toContain("reservationId");
  });

  it("maps an unknown assessment to the standard problem envelope", async () => {
    const controller = new BillingUsageController(
      { execute: jest.fn() } as never,
      {
        execute: jest
          .fn<(query: unknown) => Promise<never>>()
          .mockRejectedValue(
            new OwnershipMismatchError("Assessment does not exist"),
          ),
      } as never,
    );
    await expect(
      controller.recordUsage(billingLlmUsageReportSchema.parse(WORKER_PAYLOAD)),
    ).rejects.toMatchObject({ status: 403 });
  });
});
