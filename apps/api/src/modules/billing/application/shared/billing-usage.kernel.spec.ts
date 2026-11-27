import { describe, expect, it, jest } from "@jest/globals";
import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  LLM_USAGE_AVAILABILITY_REASONS,
  LLM_USAGE_STATUSES,
  MODEL_ATTEMPT_STATUSES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  REFERENCE_COST_STATUSES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import type { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../../../../config/config.types.js";
import {
  BillingDomainError,
  BillingIdempotencyConflictError,
} from "../../domain/billing.errors.js";
import type { BillingTransactionPort } from "../../domain/repositories/billing-transaction.port.js";
import type { LlmUsageRecordInput } from "../commands/billing-usage.types.js";
import { BillingUsageKernel } from "./billing-usage.kernel.js";

const OCCURRED_AT = new Date("2026-10-01T00:00:00.000Z");
const REPORTED = {
  provider: "LLM7",
  model: "future-model-v99",
  policyVersion: "cfg-0123456789abcdef",
  effectiveAt: "1970-01-01T00:00:00.000Z",
};

type StoredUsage = Record<string, unknown> & { id: string };

/** Any wallet, ledger, reservation or pricing access is a product-rule violation. */
const forbidden = (name: string) =>
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`usage recording must not touch ${name}`);
      },
    },
  );

function harness(ensure?: jest.Mock<(input: unknown) => Promise<unknown>>) {
  const rows: StoredUsage[] = [];
  const create = jest
    .fn<(input: Record<string, unknown>) => Promise<StoredUsage>>()
    .mockImplementation((input) => {
      // Prisma returns null for columns the caller left unset.
      const nullable = Object.fromEntries(
        [
          "assessmentId",
          "inputTokensIncludingCache",
          "cacheWrite5mTokens",
          "cacheWrite1hTokens",
          "visibleOutputTokens",
          "inputTokens",
          "cachedInputTokens",
          "cacheWriteTokens",
          "outputTokens",
          "reasoningTokens",
          "totalTokens",
          "providerResponseId",
        ].map((key) => [key, input[key] ?? null]),
      );
      const row = { id: `usage-${rows.length + 1}`, ...input, ...nullable };
      rows.push(row);
      return Promise.resolve(row);
    });
  const repos = {
    wallet: forbidden("wallet"),
    ledger: forbidden("ledger"),
    reservation: forbidden("reservation"),
    pricing: forbidden("pricing"),
    usage: {
      findByInvocation: (userId: string, invocationId: string) =>
        Promise.resolve(
          rows.find(
            (row) => row.userId === userId && row.invocationId === invocationId,
          ) ?? null,
        ),
      findByProviderResponse: (provider: string, responseId: string) =>
        Promise.resolve(
          rows.find(
            (row) =>
              row.provider === provider &&
              row.providerResponseId === responseId,
          ) ?? null,
        ),
      update: (id: string, input: Record<string, unknown>) => {
        const row = rows.find((x) => x.id === id)!;
        Object.assign(row, input);
        return Promise.resolve(row);
      },
      create,
    },
    runtimePolicy: {
      ensure:
        ensure ??
        jest.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({
          id: "snap",
          role: "root",
          ...REPORTED,
          effectiveAt: new Date(REPORTED.effectiveAt),
        }),
    },
  };
  const kernel = new BillingUsageKernel({
    runForUser: (_user: string, op: (r: unknown) => unknown) =>
      Promise.resolve(op(repos)),
  } as unknown as BillingTransactionPort);
  const record = (overrides: Partial<LlmUsageRecordInput> = {}) =>
    kernel.recordUsage({
      userId: "user",
      assessmentId: "a1",
      runId: "r1",
      invocationId: "inv-1",
      agentRole: "root",
      provider: "LLM7",
      model: "future-model-v99",
      inputTokens: 10n,
      outputTokens: 5n,
      occurredAt: OCCURRED_AT,
      ...overrides,
    });
  return { record, create, rows, repos };
}

describe("BillingUsageKernel provider token telemetry", () => {
  it("records provider-reported tokens for an unknown future model with no pricing, reservation or wallet", async () => {
    const { record, create } = harness();
    await record({ effectiveRuntimeModel: REPORTED, reasoningTokens: 3n });

    const stored = create.mock.calls[0][0];
    expect(stored).toMatchObject({
      provider: "LLM7",
      model: "future-model-v99",
      inputTokens: 10n,
      outputTokens: 5n,
      reasoningTokens: 3n,
      status: LLM_USAGE_STATUSES.SETTLED,
      runtimePolicySnapshotId: "snap",
    });
    for (const monetary of [
      "pricingSnapshotId",
      "providerCostCredits",
      "customerChargeVnd",
      "chargedCredits",
      "reservationId",
    ])
      expect(stored).not.toHaveProperty(monetary);
  });

  it("never zero-fills dimensions the provider did not report", async () => {
    const { record, create } = harness();
    await record({ outputTokens: undefined });
    const stored = create.mock.calls[0][0];
    expect(stored.inputTokens).toBe(10n);
    expect(stored.outputTokens).toBeUndefined();
    expect(stored.cachedInputTokens).toBeUndefined();
    expect(stored.reasoningTokens).toBeUndefined();
  });

  it("marks a report with no token fields as unavailable instead of inventing zeros", async () => {
    const { record, create } = harness();
    await record({ inputTokens: undefined, outputTokens: undefined });
    expect(create.mock.calls[0][0]).toMatchObject({
      status: LLM_USAGE_STATUSES.UNAVAILABLE,
      availabilityReason:
        LLM_USAGE_AVAILABILITY_REASONS.providerUsageMetadataMissing,
    });
  });

  it("is idempotent on (userId, invocationId) and rejects a differing replay", async () => {
    const { record, create } = harness();
    const first = await record();
    const replay = await record();
    expect(replay).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(record({ inputTokens: 11n })).rejects.toBeInstanceOf(
      BillingIdempotencyConflictError,
    );
  });

  it("rejects reusing one provider response id for a different invocation", async () => {
    const { record } = harness();
    await record({ providerResponseId: "resp-1" });
    await expect(
      record({ invocationId: "inv-2", providerResponseId: "resp-1" }),
    ).rejects.toBeInstanceOf(BillingIdempotencyConflictError);
  });

  it("rejects negative token counts", async () => {
    const { record, create } = harness();
    await expect(record({ inputTokens: -1n })).rejects.toThrow("negative");
    expect(create).not.toHaveBeenCalled();
  });

  it("derives the runtime policy snapshot from the reported model without any seed", async () => {
    const ensure = jest
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({
        id: "snap",
        role: "root",
        ...REPORTED,
        effectiveAt: new Date(REPORTED.effectiveAt),
      });
    const { record } = harness(ensure);
    await record({ effectiveRuntimeModel: REPORTED });
    expect(ensure).toHaveBeenCalledWith({
      role: "root",
      provider: "LLM7",
      model: "future-model-v99",
      policyVersion: "cfg-0123456789abcdef",
      effectiveAt: new Date(REPORTED.effectiveAt),
    });
  });

  it("stores usage without a snapshot when no effective runtime model is reported", async () => {
    const ensure = jest.fn<(input: unknown) => Promise<unknown>>();
    const { record, create } = harness(ensure);
    await record();
    expect(ensure).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].runtimePolicySnapshotId).toBeUndefined();
  });

  it("propagates a conflicting immutable snapshot", async () => {
    const ensure = jest
      .fn<(input: unknown) => Promise<unknown>>()
      .mockRejectedValue(new BillingDomainError("already bound"));
    const { record } = harness(ensure);
    await expect(record({ effectiveRuntimeModel: REPORTED })).rejects.toThrow(
      "already bound",
    );
  });

  it("rejects over-long or future-dated reported identities", async () => {
    const ensure = jest.fn<(input: unknown) => Promise<unknown>>();
    const { record } = harness(ensure);
    await expect(
      record({
        effectiveRuntimeModel: { ...REPORTED, policyVersion: "x".repeat(161) },
      }),
    ).rejects.toThrow("too long");
    await expect(
      record({
        effectiveRuntimeModel: {
          ...REPORTED,
          effectiveAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("not active");
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe("physical attempt reconciliation", () => {
  it("keeps missing usage unavailable when completion has no reported buckets", async () => {
    const { record, rows } = harness();
    const missing = { inputTokens: undefined, outputTokens: undefined };
    await record({ ...missing, attemptStatus: MODEL_ATTEMPT_STATUSES.STARTED });
    await record({
      ...missing,
      attemptStatus: MODEL_ATTEMPT_STATUSES.COMPLETED,
    });
    expect(rows[0].status).toBe(LLM_USAGE_STATUSES.UNAVAILABLE);
    expect(rows[0].availabilityReason).toBe(
      LLM_USAGE_AVAILABILITY_REASONS.providerUsageMetadataMissing,
    );
    expect(rows[0].inputTokens).toBeNull();
    expect(rows[0].outputTokens).toBeNull();
  });

  it("keeps one row across start, timeout, late response and duplicate response without repricing", async () => {
    const { record, rows } = harness();
    const identity = {
      provider: "MIRAIAPI",
      model: "claude-sonnet-5",
      occurredAt: new Date("2026-10-22T16:00:00Z"),
    };
    await record({
      ...identity,
      attemptStatus: MODEL_ATTEMPT_STATUSES.STARTED,
      inputTokens: undefined,
      outputTokens: undefined,
    });
    await record({
      ...identity,
      attemptStatus: MODEL_ATTEMPT_STATUSES.OUTCOME_UNKNOWN,
      inputTokens: undefined,
      outputTokens: undefined,
      failureClass: "TimeoutError",
    });
    const usage = {
      ...identity,
      attemptStatus: MODEL_ATTEMPT_STATUSES.COMPLETED,
      inputTokens: 10n,
      cachedInputTokens: 2n,
      cacheWriteTokens: 0n,
      outputTokens: 5n,
    };
    await record(usage);
    const snapshot = rows[0].referenceCostSnapshot;
    await record(usage);
    await record({
      ...identity,
      attemptStatus: MODEL_ATTEMPT_STATUSES.STARTED,
      inputTokens: undefined,
      outputTokens: undefined,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].attemptStatus).toBe(MODEL_ATTEMPT_STATUSES.COMPLETED);
    expect(rows[0].availabilityReason).toBeNull();
    expect(rows[0].referenceCostSnapshot).toBe(snapshot);
    expect(snapshot).toMatchObject({
      estimatedCostUsd: "0.0000704",
      status: REFERENCE_COST_STATUSES.COMPLETE,
    });
    await expect(record({ ...usage, outputTokens: 6n })).rejects.toBeInstanceOf(
      BillingIdempotencyConflictError,
    );
    // Repair the stale marker on already-completed rows without repricing them.
    rows[0].availabilityReason =
      LLM_USAGE_AVAILABILITY_REASONS.providerUsageMetadataMissing;
    await record(usage);
    expect(rows[0].availabilityReason).toBeNull();
    expect(rows[0].referenceCostSnapshot).toBe(snapshot);
  });
});

describe("Mercury 3 captured reference costs", () => {
  it("reconciles interleaved physical attempts once without fabricating customer reservations or invoice costs", async () => {
    const { record, rows } = harness();
    const common = {
      provider: "INCEPTION",
      model: "mercury-3",
      occurredAt: new Date("2026-10-29T06:04:00Z"),
      inputTokens: 100n,
      inputTokensIncludingCache: 1100n,
      cachedInputTokens: 1000n,
      cacheWriteTokens: 0n,
      outputTokens: 200n,
      reasoningTokens: 150n,
    };
    await Promise.all(
      ["a", "b"].map(async (key) => {
        const identity = {
          ...common,
          userId: `user-${key}`,
          assessmentId: `assessment-${key}`,
          runId: `root-${key}`,
          invocationId: `physical-${key}`,
        };
        await record({
          ...identity,
          attemptStatus: MODEL_ATTEMPT_STATUSES.STARTED,
        });
        const completed = {
          ...identity,
          attemptStatus: MODEL_ATTEMPT_STATUSES.COMPLETED,
          providerResponseId: `response-${key}`,
        };
        await record(completed);
        await record(completed);
      }),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.referenceCostSnapshot).toMatchObject({
        status: REFERENCE_COST_STATUSES.COMPLETE,
        estimatedCostUsd: "0.00009",
        canonicalModel: "mercury-3",
        priceVersionId: "inception:mercury-3:launch:2026-10-29",
      });
      expect(row.reservationId).toBeUndefined();
      expect(row.customerChargeVnd).toBeUndefined();
      expect(row.providerCostCredits).toBeUndefined();
    }
  });
});

describe("BillingUsageKernel direct-credit admission & settlement (MODEL_USAGE_DEBIT = OFF)", () => {
  const createKernel = (debitMode?: string) => {
    const config = debitMode
      ? ({
          get: (key: string) =>
            key === "modelUsageDebit" ? { mode: debitMode } : undefined,
        } as unknown as ConfigService<AppConfig, true>)
      : undefined;
    const tx = {
      runForUser: jest.fn(),
    } as unknown as BillingTransactionPort;
    return new BillingUsageKernel(tx, undefined, config);
  };

  const baseAdmissionInput = {
    invocationId: "inv-admit-1",
    walletId: "wallet-1",
    spendableMicrocredits: 5_000_000n,
    inFlightCount: 0,
    resolvedModel: "gemini-2.5-pro",
    provider: "google",
    allowlistedModels: ["gemini-2.5-pro"],
    availableScopes: [
      MODEL_PRICING_SCOPES.globalDefault,
      MODEL_PRICING_SCOPES.exactModel,
    ],
    pricingSnapshotId: "tariff-snap-1",
    maxInputTokens: 100_000n,
    maxOutputTokens: 10_000n,
    ratesMicrocreditsPerMillion: {
      input: 1_250_000n,
      output: 10_000_000n,
      reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
    },
  };

  describe("issueModelUsageAdmission", () => {
    it("admits CUSTOMER_WALLET invocations and passes through full MicrocreditTariffRates", () => {
      const kernel = createKernel();
      const admission = kernel.issueModelUsageAdmission({
        ...baseAdmissionInput,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
        maxCachedInputTokens: 50_000n,
        maxCacheWriteTokens: 20_000n,
        ratesMicrocreditsPerMillion: {
          input: 1_000_000n,
          output: 2_000_000n,
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
          cachedInput: 500_000n,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.separateRate,
          cacheWrite: 1_500_000n,
        },
      });

      // 100k*1M + 10k*2M + 50k*0.5M + 20k*1.5M = 100k + 20k + 25k + 30k = 175_000 microcredits
      expect(admission).toEqual({
        invocationId: "inv-admit-1",
        walletId: "wallet-1",
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
        state: ADMISSION_STATES.ADMITTED,
        resolvedModel: "gemini-2.5-pro",
        provider: "google",
        pricingSnapshotId: "tariff-snap-1",
        pricingResolution: MODEL_PRICING_SCOPES.exactModel,
        maximumExposureMicrocredits: 175_000n,
      });
    });

    it("rejects CUSTOMER_WALLET when balance <= 0, slot occupied, walletId blank, maxOutputTokens <= 0, maxInputTokens < 0, or unlisted/untrimmed model", () => {
      const kernel = createKernel();

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          spendableMicrocredits: 0n,
        }),
      ).toThrow(BillingDomainError);

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          inFlightCount: 1,
        }),
      ).toThrow(BillingDomainError);

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          walletId: "   ",
        }),
      ).toThrow(BillingDomainError);

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          walletId: null,
        }),
      ).toThrow(BillingDomainError);

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          maxOutputTokens: 0n,
        }),
      ).toThrow(BillingDomainError);

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          maxInputTokens: -1n,
        }),
      ).toThrow(BillingDomainError);

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          resolvedModel: "unlisted-model",
        }),
      ).toThrow();

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          provider: " google ",
        }),
      ).toThrow();
    });

    it("enforces walletId === null for PLATFORM_SPONSORED and allows 0n customer wallet balance", () => {
      const kernel = createKernel();

      expect(() =>
        kernel.issueModelUsageAdmission({
          ...baseAdmissionInput,
          fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
          walletId: "wallet-1",
        }),
      ).toThrow(
        "PLATFORM_SPONSORED admission must not bind a customer walletId",
      );

      const sponsored = kernel.issueModelUsageAdmission({
        ...baseAdmissionInput,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
        walletId: null,
        spendableMicrocredits: 0n,
      });

      expect(sponsored.fundingPrincipal).toBe(
        ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
      );
      expect(sponsored.walletId).toBeNull();
      expect(sponsored.state).toBe(ADMISSION_STATES.ADMITTED);
    });
  });

  describe("settleAdmittedUsage", () => {
    const admission = {
      invocationId: "inv-settle-1",
      walletId: "wallet-1",
      maximumExposureMicrocredits: 200_000n,
      ratesMicrocreditsPerMillion: {
        input: 1_000_000n,
        output: 2_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      },
    };

    it("defaults to MODEL_USAGE_DEBIT = OFF from ConfigService and leaves ledger balance unchanged", () => {
      const kernel = createKernel(MODEL_USAGE_DEBIT_MODES.OFF);
      const settled = kernel.settleAdmittedUsage({
        admission,
        reportedUsage: {
          invocationId: "inv-settle-1",
          inputTokens: 100_000n,
          outputTokens: 50_000n,
        },
        currentLedgerBalanceMicrocredits: 1_000_000n,
      });

      expect(settled.debitMode).toBe(MODEL_USAGE_DEBIT_MODES.OFF);
      expect(settled.actualChargeMicrocredits).toBe(200_000n);
      expect(settled.exceededAdmittedExposure).toBe(false);
      expect(settled.state).toBe(ADMISSION_STATES.SETTLED);
      expect(settled.projectedWallet).toEqual({
        ledgerBalanceMicrocredits: "1000000",
        spendableMicrocredits: "1000000",
        outstandingMicrocredits: "0",
      });
    });

    it("fails closed when ConfigService or debitMode resolves MODEL_USAGE_DEBIT = ON", () => {
      const kernelWithOnConfig = createKernel(MODEL_USAGE_DEBIT_MODES.ON);
      expect(() =>
        kernelWithOnConfig.settleAdmittedUsage({
          admission,
          reportedUsage: {
            invocationId: "inv-settle-1",
            inputTokens: 10n,
            outputTokens: 10n,
          },
          currentLedgerBalanceMicrocredits: 1_000_000n,
        }),
      ).toThrow(BillingDomainError);

      const kernelDefault = createKernel();
      expect(() =>
        kernelDefault.settleAdmittedUsage({
          debitMode: MODEL_USAGE_DEBIT_MODES.ON,
          admission,
          reportedUsage: {
            invocationId: "inv-settle-1",
            inputTokens: 10n,
            outputTokens: 10n,
          },
          currentLedgerBalanceMicrocredits: 1_000_000n,
        }),
      ).toThrow(BillingDomainError);
    });

    it("rejects invocationId mismatch between admission and reportedUsage", () => {
      const kernel = createKernel(MODEL_USAGE_DEBIT_MODES.OFF);
      expect(() =>
        kernel.settleAdmittedUsage({
          admission,
          reportedUsage: {
            invocationId: "inv-other",
            inputTokens: 10n,
            outputTokens: 10n,
          },
          currentLedgerBalanceMicrocredits: 1_000_000n,
        }),
      ).toThrow(BillingDomainError);
    });

    it("computes signed SHADOW projection (including negative balance) and flags BILLING_INTEGRITY_REVIEW when exceeding maximumExposureMicrocredits", () => {
      const kernel = createKernel(MODEL_USAGE_DEBIT_MODES.SHADOW);
      const settled = kernel.settleAdmittedUsage({
        admission,
        reportedUsage: {
          invocationId: "inv-settle-1",
          inputTokens: 100_000n,
          outputTokens: 100_000n, // 100k + 200k = 300_000 > 200_000 exposure
        },
        currentLedgerBalanceMicrocredits: 100_000n,
      });

      expect(settled.debitMode).toBe(MODEL_USAGE_DEBIT_MODES.SHADOW);
      expect(settled.actualChargeMicrocredits).toBe(300_000n);
      expect(settled.exceededAdmittedExposure).toBe(true);
      expect(settled.state).toBe(ADMISSION_STATES.BILLING_INTEGRITY_REVIEW);
      expect(settled.projectedWallet).toEqual({
        ledgerBalanceMicrocredits: "-200000",
        spendableMicrocredits: "0",
        outstandingMicrocredits: "200000",
      });
    });
  });
});
