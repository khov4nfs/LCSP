/**
 * Rationale ("Why"): Validates G-07 Transaction Compensation & Debit Linking contracts (ADR-028 Line 159).
 * Mechanism ("How"): Asserts error codes, audit event types, and request/response Zod schema parsing.
 * Invariants & Constraints: Amount must be a positive decimal integer string of microcredits;
 * response enforces UUIDs and integer string balances.
 */

import { describe, expect, it } from "@jest/globals";
import {
  BILLING_ACTIONS,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  CREDIT_LEDGER_SOURCES,
  compensateBillingDebitRequestSchema,
  compensateBillingDebitResponseSchema,
} from "../src/billing/index.ts";

describe("WP8 G-07 Billing Compensation Contracts", () => {
  it("defines canonical error codes, audit event types, and distinct action permissions for compensation", () => {
    expect(BILLING_ERROR_CODES.debitNotFound).toBe("BILLING_DEBIT_NOT_FOUND");
    expect(BILLING_ERROR_CODES.debitNotEligible).toBe("BILLING_DEBIT_NOT_ELIGIBLE");
    expect(BILLING_ERROR_CODES.compensationLimitExceeded).toBe("BILLING_COMPENSATION_LIMIT_EXCEEDED");
    expect(BILLING_ERROR_CODES.compensationAmountInvalid).toBe("BILLING_COMPENSATION_AMOUNT_INVALID");
    expect(BILLING_AUDIT_EVENT_TYPES.compensationIssued).toBe("billing.debit.compensated");
    expect(CREDIT_LEDGER_SOURCES.COMPENSATION).toBe("COMPENSATION");
    expect(BILLING_ACTIONS.compensation).toBe("billing:debit:compensate");
  });

  it("validates valid compensation request payload", () => {
    const valid = {
      originalLedgerEntryId: "11111111-1111-1111-1111-111111111111",
      amountMicrocredits: "5000000",
      reason: "Provider outage failure compensation approved by admin",
      idempotencyKey: "idem-comp-12345",
    };
    const parsed = compensateBillingDebitRequestSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("strictly rejects client-injected unknown fields such as walletId, userId, or client-supplied balances", () => {
    const maliciousPayload = {
      originalLedgerEntryId: "11111111-1111-1111-1111-111111111111",
      amountMicrocredits: "5000000",
      reason: "Provider outage failure compensation approved by admin",
      idempotencyKey: "idem-comp-12345",
      walletId: "hack-wallet-id",
      userId: "hack-user-id",
      balanceMicrocredits: "9999999999",
    };
    const parsed = compensateBillingDebitRequestSchema.safeParse(maliciousPayload);
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid compensation request payloads (negative, zero, empty, or short reason)", () => {
    // Zero amount
    expect(
      compensateBillingDebitRequestSchema.safeParse({
        originalLedgerEntryId: "11111111-1111-1111-1111-111111111111",
        amountMicrocredits: "0",
        reason: "Valid reason text",
        idempotencyKey: "idem-comp-12345",
      }).success,
    ).toBe(false);

    // Negative amount
    expect(
      compensateBillingDebitRequestSchema.safeParse({
        originalLedgerEntryId: "11111111-1111-1111-1111-111111111111",
        amountMicrocredits: "-500",
        reason: "Valid reason text",
        idempotencyKey: "idem-comp-12345",
      }).success,
    ).toBe(false);

    // Non-numeric amount
    expect(
      compensateBillingDebitRequestSchema.safeParse({
        originalLedgerEntryId: "11111111-1111-1111-1111-111111111111",
        amountMicrocredits: "abc",
        reason: "Valid reason text",
        idempotencyKey: "idem-comp-12345",
      }).success,
    ).toBe(false);

    // Reason too short (< 5 chars)
    expect(
      compensateBillingDebitRequestSchema.safeParse({
        originalLedgerEntryId: "11111111-1111-1111-1111-111111111111",
        amountMicrocredits: "500",
        reason: "abc",
        idempotencyKey: "idem-comp-12345",
      }).success,
    ).toBe(false);
  });

  it("validates server response schema structure", () => {
    const validResponse = {
      compensated: true,
      ledgerEntryId: "22222222-2222-2222-2222-222222222222",
      walletId: "33333333-3333-3333-3333-333333333333",
      userId: "44444444-4444-4444-4444-444444444444",
      originalLedgerEntryId: "11111111-1111-1111-1111-111111111111",
      originalDebitMicrocredits: "10000000",
      compensatedMicrocredits: "4000000",
      totalCompensatedMicrocredits: "4000000",
      remainingUncompensatedMicrocredits: "6000000",
      walletBalanceMicrocredits: "94000000",
      walletVersion: 5,
      compensatedAt: new Date().toISOString(),
    };
    const parsed = compensateBillingDebitResponseSchema.safeParse(validResponse);
    expect(parsed.success).toBe(true);
  });
});
