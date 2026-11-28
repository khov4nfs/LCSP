import { jest } from "@jest/globals";
import {
  ADMISSION_STATES,
  computeAdmissionRequestFingerprint,
} from "@lcsp/contracts/billing";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { ModelPricingRepositoryPort } from "../../../domain/repositories/model-pricing.port.js";
import type { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import type { BillingRolloutAuthorityService } from "../../shared/billing-rollout-authority.service.js";
import { RequestBillableInvocationAdmissionCommand } from "./request-billable-invocation-admission.command.js";
import { RequestBillableInvocationAdmissionHandler } from "./request-billable-invocation-admission.handler.js";

describe("RequestBillableInvocationAdmissionHandler - Hardening", () => {
  it("does not expire an admission when consume wins the replay race", async () => {
    // Why: A replay may read expired ADMITTED just before consume commits IN_FLIGHT.
    // How: Make consume win at the write boundary and inspect the persisted state after replay.
    // Invariant: An in-flight provider call must retain its wallet slot and exposure.
    const payload = {
      admissionRequestId: "req-expiry-race",
      logicalOperationId: "op-expiry-race",
      attemptOrdinal: 1,
      runId: "run-expiry-race",
      assessmentId: "asm-expiry-race",
      executionLeaseToken: "lease-expiry-race",
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 2000,
    };
    const existing = {
      id: "adm-expiry-race",
      invocationId: "inv-expiry-race",
      admissionRequestId: payload.admissionRequestId,
      requestFingerprint: computeAdmissionRequestFingerprint(payload),
      executionLeaseToken: payload.executionLeaseToken,
      runId: payload.runId,
      state:
        ADMISSION_STATES.ADMITTED as (typeof ADMISSION_STATES)[keyof typeof ADMISSION_STATES],
      version: 1,
      expiresAt: new Date("2026-11-27T00:00:00.000Z"),
      admittedAt: new Date("2026-11-26T23:55:00.000Z"),
      fundingPrincipal: "CUSTOMER_WALLET",
      rolloutMode: "MANDATORY_ADMISSION",
      debitMode: "OFF",
      tariffSnapshotId: null,
      tariffAssignmentId: null,
      sponsorshipPolicySnapshotId: null,
      appliedMaxOutputTokens: 2000,
      resolvedProvider: "anthropic",
      resolvedModel: "claude-sonnet-4-6",
      maximumExposureMicrocredits: 1000n,
      initialExposureMicrocredits: 1000n,
    };
    const findUnique = jest
      .fn<() => Promise<typeof existing>>()
      .mockResolvedValue(existing);
    const update = jest
      .fn<() => Promise<typeof existing>>()
      .mockImplementation(() => {
        existing.state = ADMISSION_STATES.IN_FLIGHT;
        existing.state = ADMISSION_STATES.EXPIRED;
        return Promise.resolve(existing);
      });
    const updateMany = jest
      .fn<() => Promise<{ count: number }>>()
      .mockImplementation(() => {
        existing.state = ADMISSION_STATES.IN_FLIGHT;
        return Promise.resolve({ count: 0 });
      });
    const prisma = {
      billableInvocationAdmission: { findUnique, update, updateMany },
    };
    const handler = new RequestBillableInvocationAdmissionHandler(
      prisma as unknown as PrismaService,
      {
        get: () => "dedicated-server-master-secret",
      } as unknown as ConfigService,
      {
        getDbUtcNow: () =>
          Promise.resolve(new Date("2026-11-28T00:00:00.000Z")),
      } as unknown as ModelPricingRepositoryPort,
      {} as ModelPricingCalculatorService,
      {} as BillingRolloutAuthorityService,
    );

    await handler.execute(
      new RequestBillableInvocationAdmissionCommand(payload),
    );
    expect(existing.state).toBe(ADMISSION_STATES.IN_FLIGHT);
    expect(update).not.toHaveBeenCalled();
  });

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
      mockRolloutAuthority as unknown as BillingRolloutAuthorityService,
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
