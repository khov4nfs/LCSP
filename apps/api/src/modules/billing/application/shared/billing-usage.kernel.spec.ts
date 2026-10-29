import { describe, expect, it, jest } from "@jest/globals";
import {
  LLM_USAGE_AVAILABILITY_REASONS,
  LLM_USAGE_STATUSES,
  MODEL_ATTEMPT_STATUSES,
  REFERENCE_COST_STATUSES,
} from "@lcsp/contracts/billing";

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
