import { describe, expect, it } from "@jest/globals";
import {
  ADMISSION_STATES,
  BILLING_ROLLOUT_MODES,
  MODEL_USAGE_DEBIT_MODES,
  PROVIDER_COMPLETION_STATES,
  billableInvocationSettlementRequestSchema,
  billableInvocationSettlementResponseSchema,
} from "../src/billing/index.ts";

describe("WP8 settlement depletion signal contract", () => {
  const settled = {
    settled: true,
    state: ADMISSION_STATES.SETTLED,
    rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
    debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    calculatedMicrocredits: "45000",
    debitedMicrocredits: "45000",
    shadowMicrocredits: null,
    chargedMicrocredits: "45000",
    slotReleased: true,
    settledAt: "2026-11-28T00:00:00.000Z",
  };

  it("requires and preserves the server-owned paymentRequired decision", () => {
    // Why: The final provider call can deplete a wallet without another admission that returns 402.
    // How: Require the server's post-settlement solvency decision in the result contract.
    // Invariant: Workers must not guess depletion from usage or a stale pre-call wallet balance.
    expect(billableInvocationSettlementResponseSchema.safeParse(settled).success).toBe(false);
    const parsed = billableInvocationSettlementResponseSchema.parse({
      ...settled,
      paymentRequired: true,
    }) as typeof settled & { paymentRequired?: boolean };
    expect(parsed.paymentRequired).toBe(true);
  });

  it("preserves split cache-write token buckets in the worker settlement request", () => {
    // Why: A provider can charge 5-minute and 1-hour cache writes at different published rates.
    // How: Parse the worker payload and require both split buckets to survive the HTTP boundary.
    // Invariant: The server must not silently discard priced usage before canonical settlement.
    const parsed = billableInvocationSettlementRequestSchema.parse({
      admissionId: "admission-1",
      invocationId: "invocation-1",
      capabilityToken: "a".repeat(48),
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 3,
      cacheWriteTokens: 3,
      cacheWrite5mTokens: 1,
      cacheWrite1hTokens: 2,
    });
    expect(parsed.cacheWrite5mTokens).toBe(1);
    expect(parsed.cacheWrite1hTokens).toBe(2);
  });

  it("pins bounded canonical tool call IDs without accepting duplicate or unsorted evidence", () => {
    // Why: A later domain rejection must refer to a tool call emitted by this exact paid model response.
    // How: Preserve a bounded sorted set at settlement and reject ambiguous duplicate IDs.
    // Invariant: Callback cannot invent a new tool call after the immutable receipt commits.
    const base = {
      admissionId: "admission-1",
      invocationId: "invocation-1",
      capabilityToken: "a".repeat(48),
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    };
    expect(billableInvocationSettlementRequestSchema.parse({
      ...base, toolCallIds: ["call-a", "call-b"],
    }).toolCallIds).toEqual(["call-a", "call-b"]);
    expect(billableInvocationSettlementRequestSchema.safeParse({
      ...base, toolCallIds: ["call-b", "call-a"],
    }).success).toBe(false);
    expect(billableInvocationSettlementRequestSchema.safeParse({
      ...base, toolCallIds: ["call-a", "call-a"],
    }).success).toBe(false);
    expect(billableInvocationSettlementRequestSchema.safeParse({
      ...base, toolCallIds: ["call-😀"],
    }).success).toBe(false);
    expect(billableInvocationSettlementRequestSchema.safeParse({
      ...base, toolCallIds: ["call-\nnew-line"],
    }).success).toBe(false);
    expect(billableInvocationSettlementRequestSchema.safeParse({
      ...base, toolCallIds: Array.from({ length: 65 }, (_, index) => `call-${index}`),
    }).success).toBe(false);
    expect(billableInvocationSettlementRequestSchema.safeParse({
      ...base, providerCompletionState: PROVIDER_COMPLETION_STATES.OUTCOME_UNKNOWN,
      toolCallIds: ["call-a"],
    }).success).toBe(false);
  });
});
