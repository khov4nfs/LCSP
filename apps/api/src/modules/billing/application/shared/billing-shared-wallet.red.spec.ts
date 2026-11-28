import { describe, expect, it } from "@jest/globals";
import * as billingContracts from "@lcsp/contracts/billing";
import { BillingUsageKernel } from "./billing-usage.kernel.js";

describe("ASM-BUDGET-02..04: Shared Prepaid Wallet & Actual-Usage Settlement RED Contracts", () => {
  it("ASM-BUDGET-02: contracts expose microcredit unit scale (1 public credit = 1_000_000 microcredits) and canonical decimal formatter/parser", () => {
    const contracts = billingContracts as Record<string, unknown>;
    expect(contracts.MICROCREDITS_PER_CREDIT).toBe(1_000_000n);

    const formatMicrocredits = contracts.formatMicrocreditsToDecimal as
      ((microcredits: bigint) => string) | undefined;
    const parseDecimalToMicrocredits = contracts.parseDecimalToMicrocredits as
      ((decimal: string) => bigint) | undefined;

    expect(typeof formatMicrocredits).toBe("function");
    expect(typeof parseDecimalToMicrocredits).toBe("function");

    const sample = 1_234_567n;
    const formatted = formatMicrocredits!(sample);
    expect(formatted).toBe("1.234567");
    expect(parseDecimalToMicrocredits!(formatted)).toBe(sample);
    expect(() => parseDecimalToMicrocredits!("1.2345678")).toThrow();
    expect(() => parseDecimalToMicrocredits!("1e6")).toThrow();
  });

  it("ASM-BUDGET-03: BillingUsageKernel exposes server-issued admission & atomic actual-usage debit boundary", () => {
    const kernelProto = BillingUsageKernel.prototype as unknown as Record<
      string,
      unknown
    >;
    // Contract 14 & 16: Billing must provide server-issued admission and atomic settlement debit
    expect(typeof kernelProto.issueModelUsageAdmission).toBe("function");
    expect(typeof kernelProto.settleAdmittedUsage).toBe("function");
  });

  it("ASM-BUDGET-04: contracts expose signed wallet projection helper (spendableCredits = max(balance,0), outstandingCredits = max(-balance,0))", () => {
    const contracts = billingContracts as Record<string, unknown>;
    const projectWalletBalance = contracts.projectSignedWalletBalance as
      | ((ledgerBalanceMicrocredits: bigint) => {
          ledgerBalanceMicrocredits: string;
          spendableMicrocredits: string;
          outstandingMicrocredits: string;
        })
      | undefined;

    expect(typeof projectWalletBalance).toBe("function");

    const negativeProjection = projectWalletBalance!(-250_000n);
    expect(negativeProjection.spendableMicrocredits).toBe("0");
    expect(negativeProjection.outstandingMicrocredits).toBe("250000");

    const positiveProjection = projectWalletBalance!(500_000n);
    expect(positiveProjection.spendableMicrocredits).toBe("500000");
    expect(positiveProjection.outstandingMicrocredits).toBe("0");
  });
});
