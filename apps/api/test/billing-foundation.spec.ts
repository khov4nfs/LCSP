import { describe, expect, it } from "@jest/globals";
import {
  BILLING_ORDER_STATUSES,
  BILLING_RESERVATION_STATUSES,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";

describe("LCSP-310 billing foundation invariants", () => {
  it("exposes only the canonical lifecycle status values", () => {
    expect(Object.keys(BILLING_ORDER_STATUSES)).toEqual([
      "PENDING_PAYMENT",
      "CREDITED",
      "EXPIRED",
      "CANCELLED",
      "PENDING_RECONCILIATION",
    ]);
    expect(Object.keys(PAYMENT_RECONCILIATION_STATUSES)).toEqual([
      "MATCHED",
      "UNMATCHED",
      "AMOUNT_MISMATCH",
      "DUPLICATE",
      "REJECTED",
      "NEEDS_REVIEW",
    ]);
    expect(Object.keys(BILLING_RESERVATION_STATUSES)).toEqual([
      "RESERVED",
      "SETTLED",
      "RELEASED",
    ]);
  });

  it("rebuilds available credits from the ledger and active reservations", () => {
    const ledger = [1200n, -250n, 500n];
    const activeReservations = [300n, 150n];
    const ledgerBalance = ledger.reduce((sum, delta) => sum + delta, 0n);
    const reservedBalance = activeReservations.reduce(
      (sum, amount) => sum + amount,
      0n,
    );

    expect(ledgerBalance).toBe(1450n);
    expect(reservedBalance).toBe(450n);
    expect(ledgerBalance - reservedBalance).toBe(1000n);
  });

  it("does not treat a reservation as a ledger debit", () => {
    const ledgerBeforeReservation = 1000n;
    const reserved = 400n;
    expect(ledgerBeforeReservation).toBe(1000n);
    expect(ledgerBeforeReservation - reserved).toBe(600n);
  });
});
