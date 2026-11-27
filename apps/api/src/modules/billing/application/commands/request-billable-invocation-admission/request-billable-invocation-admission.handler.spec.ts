import { jest } from "@jest/globals";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { ModelPricingRepositoryPort } from "../../../domain/repositories/model-pricing.port.js";
import type { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { RequestBillableInvocationAdmissionCommand } from "./request-billable-invocation-admission.command.js";
import { RequestBillableInvocationAdmissionHandler } from "./request-billable-invocation-admission.handler.js";

describe("RequestBillableInvocationAdmissionHandler - Hardening", () => {
  it("HARDENING-1: fails immediately when BILLING_ADMISSION_MASTER_KEY is missing or empty, without fallback", async () => {
    // ConfigService returning undefined or empty for billing.admissionMasterKey
    const mockConfigService = {
      get: jest
        .fn<(key: string) => string | null>()
        .mockImplementation((key: string) => {
          if (key === "billing.admissionMasterKey") return "";
          if (key === "worker.apiKey") return "worker-secret-leak";
          return null;
        }),
    };

    const mockPrisma = {
      $transaction: jest.fn(),
      billableInvocationAdmission: {
        findUnique: jest.fn(),
      },
    };

    const mockPricingRepo = {
      getDbUtcNow: jest.fn<() => Promise<Date>>().mockResolvedValue(new Date()),
      listActiveAssignmentsAt: jest
        .fn<(at: Date) => Promise<never[]>>()
        .mockResolvedValue([]),
    };

    const mockCalculator = {
      resolveEffectiveTariff: jest.fn(),
      calculateCharge: jest.fn(),
    };

    const mockRolloutAuthority = {
      getActiveRolloutAuthority: jest.fn().mockReturnValue({
        rolloutMode: "TELEMETRY_ONLY",
        debitMode: "OFF",
      }),
    };

    const handler = new RequestBillableInvocationAdmissionHandler(
      mockPrisma as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
      mockPricingRepo as unknown as ModelPricingRepositoryPort,
      mockCalculator as unknown as ModelPricingCalculatorService,
      mockRolloutAuthority as any,
    );

    const command = new RequestBillableInvocationAdmissionCommand({
      admissionRequestId: "req-1",
      logicalOperationId: "op-1",
      attemptOrdinal: 1,
      runId: "run-1",
      assessmentId: "asm-1",
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 2000,
    });

    // Currently, handler falls back to "worker.apiKey" or "lcsp-internal-admission-master-key" instead of throwing!
    await expect(handler.execute(command)).rejects.toThrow(
      /BILLING_ADMISSION_MASTER_KEY is not configured or empty/i,
    );
  });
});
