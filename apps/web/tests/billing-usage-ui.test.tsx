import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  BILLING_ORDER_STATUSES,
  BILLING_PAYMENT_PROVIDERS,
  type BillingOrderView,
} from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";

const EN_LOCALE: Locale = "en";
const VI_LOCALE: Locale = "vi";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

for (const key of [
  "window",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "HTMLButtonElement",
  "Node",
  "Event",
  "MouseEvent",
  "MutationObserver",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const { WalletBalanceCard } =
  await import("../src/features/billing/components/molecules/wallet-balance-card.tsx");
const { PaymentStatusBadge } =
  await import("../src/features/billing/components/molecules/payment-status-badge.tsx");
const { PaymentOrderCard } =
  await import("../src/features/billing/components/organisms/payment-order-card.tsx");
const { TransactionHistory } =
  await import("../src/features/billing/components/organisms/transaction-history.tsx");
const { CustomerUsageSummary } =
  await import("../src/features/billing/components/molecules/customer-usage-summary.tsx");
const { billingTopUpSchema } =
  await import("../src/features/billing/schemas/billing-top-up.schema.ts");

function makeOrder(
  id: string,
  status: BillingOrderView["status"],
): BillingOrderView {
  return {
    id,
    amountVnd: "1000000",
    creditUnits: "1000000",
    paymentCode: `LCSP-${id.toUpperCase()}`,
    status,
    expiresAt: "2026-11-25T00:00:00.000Z",
    creditedAt:
      status === BILLING_ORDER_STATUSES.CREDITED
        ? "2026-11-24T01:00:00.000Z"
        : null,
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    paymentInstructions: {
      provider: BILLING_PAYMENT_PROVIDERS.sepay,
      currency: "VND",
      paymentCode: `LCSP-${id.toUpperCase()}`,
      amountVnd: "1000000",
      bankName: "Vietcombank",
      bankAccountNumber: "0123456789",
      accountHolder: "LCSP PLATFORM",
      transferContent: `LCSP-${id.toUpperCase()}`,
      qrCodeUrl: "",
    },
  };
}

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function renderNode(node: ReturnType<typeof createElement>) {
  activeContainer = document.createElement("div");
  document.body.appendChild(activeContainer);
  activeRoot = createRoot(activeContainer);
  act(() => {
    activeRoot!.render(node);
  });
  return activeContainer;
}

afterEach(() => {
  if (activeRoot) {
    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
  }
  activeContainer?.remove();
  activeContainer = null;
});

describe("Billing and Usage UI components (Frames 32-33)", () => {
  it("validates VND top-up amounts with billingTopUpSchema", () => {
    assert.equal(billingTopUpSchema.safeParse({ amountVnd: "10000" }).success, true);
    assert.equal(billingTopUpSchema.safeParse({ amountVnd: "1000000" }).success, true);
    assert.equal(billingTopUpSchema.safeParse({ amountVnd: "9999" }).success, false);
    assert.equal(billingTopUpSchema.safeParse({ amountVnd: "abc" }).success, false);
    assert.equal(billingTopUpSchema.safeParse({ amountVnd: "" }).success, false);
  });

  it("renders WalletBalanceCard with NextMetricCard embedded variant in EN and VI", () => {
    const enEl = renderNode(
      createElement(WalletBalanceCard, {
        locale: EN_LOCALE,
        formattedAvailableBalance: "15,000,000 VND",
        formattedReservedBalance: "0 VND",
      }),
    );
    assert.match(enEl.textContent ?? "", /15,000,000 VND/);
    assert.match(enEl.textContent ?? "", /Reserved balance: 0 VND/);
    assert.equal(
      enEl.querySelector('[aria-labelledby="billing-balance-heading"] p')
        ?.textContent,
      "15,000,000 VND",
    );
    assert.ok(enEl.querySelector(".bg-bento-card"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const viEl = renderNode(
      createElement(WalletBalanceCard, {
        locale: VI_LOCALE,
        formattedAvailableBalance: "15.000.000 VND",
        formattedReservedBalance: "0 VND",
      }),
    );
    assert.match(viEl.textContent ?? "", /15\.000\.000 VND/);
  });

  it("renders PaymentStatusBadge with semantic status tokens for pending, credited, and expired", () => {
    const pendingEl = renderNode(
      createElement(PaymentStatusBadge, {
        locale: EN_LOCALE,
        status: BILLING_ORDER_STATUSES.PENDING_PAYMENT,
        showDot: true,
      }),
    );
    assert.match(pendingEl.textContent ?? "", /Pending payment/);
    assert.ok(pendingEl.querySelector(".bg-status-warning-bg"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const creditedEl = renderNode(
      createElement(PaymentStatusBadge, {
        locale: EN_LOCALE,
        status: BILLING_ORDER_STATUSES.CREDITED,
      }),
    );
    assert.match(creditedEl.textContent ?? "", /Credited/);
    assert.ok(creditedEl.querySelector(".bg-status-success-bg"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const expiredEl = renderNode(
      createElement(PaymentStatusBadge, {
        locale: EN_LOCALE,
        status: BILLING_ORDER_STATUSES.EXPIRED,
      }),
    );
    assert.match(expiredEl.textContent ?? "", /Expired/);
    assert.ok(expiredEl.querySelector(".bg-status-danger-bg"));
  });

  it("renders PaymentOrderCard and invokes copy and status refresh callbacks", () => {
    let copied = 0;
    let refreshed = 0;
    const order = makeOrder("2401", BILLING_ORDER_STATUSES.PENDING_PAYMENT);
    const el = renderNode(
      createElement(PaymentOrderCard, {
        locale: EN_LOCALE,
        order,
        copied: false,
        formattedAmount: "1,000,000 VND",
        formattedCredits: "1,000,000",
        formattedExpiresAt: "Nov 25, 2026",
        formattedCreatedAt: "Nov 24, 2026",
        onCopy: () => {
          copied += 1;
        },
        onRefreshStatus: () => {
          refreshed += 1;
        },
      }),
    );

    assert.match(el.textContent ?? "", /LCSP-2401/);
    assert.match(el.textContent ?? "", /1,000,000 VND/);
    const buttons = [...el.querySelectorAll("button")];
    const copyBtn = buttons.find((b) => b.textContent?.includes("Copy code"));
    const refreshBtn = buttons.find((b) =>
      b.textContent?.includes("Check payment status"),
    );
    assert.ok(copyBtn);
    assert.ok(refreshBtn);

    act(() => {
      copyBtn.click();
      refreshBtn.click();
    });
    assert.equal(copied, 1);
    assert.equal(refreshed, 1);
  });

  it("renders TransactionHistory empty and populated states with pagination", () => {
    const emptyEl = renderNode(
      createElement(TransactionHistory, {
        locale: EN_LOCALE,
        orders: [],
        page: 1,
        pageSize: 10,
        totalCount: 0,
        isFetching: false,
        previousLabel: "Previous",
        nextLabel: "Next",
        formatAmount: (v) => `${v} VND`,
        formatDate: (v) => v.slice(0, 10),
        onPageChange: () => {},
        onOpenOrder: () => {},
      }),
    );
    assert.equal(emptyEl.querySelectorAll("tbody tr").length, 0);

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    let openedId = "";
    const popEl = renderNode(
      createElement(TransactionHistory, {
        locale: EN_LOCALE,
        orders: [
          makeOrder("101", BILLING_ORDER_STATUSES.PENDING_PAYMENT),
          makeOrder("102", BILLING_ORDER_STATUSES.CREDITED),
        ],
        page: 1,
        pageSize: 10,
        totalCount: 2,
        isFetching: false,
        previousLabel: "Previous",
        nextLabel: "Next",
        formatAmount: (v) => `${v} VND`,
        formatDate: (v) => v.slice(0, 10),
        onPageChange: () => {},
        onOpenOrder: (id) => {
          openedId = id;
        },
      }),
    );
    assert.equal(popEl.querySelectorAll("tbody tr").length, 2);
    const viewBtn = [...popEl.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.includes("LCSP-101"),
    );
    assert.ok(viewBtn);
    act(() => {
      viewBtn.click();
    });
    assert.equal(openedId, "101");
  });

  it("renders CustomerUsageSummary with NextMetricCard KPIs and token totals", () => {
    const el = renderNode(
      createElement(CustomerUsageSummary, {
        locale: EN_LOCALE,
        summary: {
          calls: 24,
          successfulResponses: 22,
          failedAttempts: 2,
          unresolvedAttempts: 0,
          usageUnknownInvocations: 0,
          unpricedInvocations: 0,
          incompleteCostInvocations: 0,
          tokens: {
            inputTokens: { known: "120000", unknownInvocations: 0 },
            outputTokens: { known: "36000", unknownInvocations: 0 },
            totalTokens: { known: "156000", unknownInvocations: 0 },
            inputTokensIncludingCache: { known: "120000", unknownInvocations: 0 },
            cachedInputTokens: { known: "0", unknownInvocations: 0 },
            cacheWriteTokens: { known: "0", unknownInvocations: 0 },
            cacheWrite5mTokens: { known: "0", unknownInvocations: 0 },
            cacheWrite1hTokens: { known: "0", unknownInvocations: 0 },
            visibleOutputTokens: { known: "36000", unknownInvocations: 0 },
            reasoningTokens: { known: "0", unknownInvocations: 0 },
          },
          estimatedCostUsd: "1.25",
          knownEstimatedCostUsd: "1.25",
        },
        sellingPrice: {
          version: "lcsp-usage-1.2-v1",
          multiplier: "1.2",
          estimatedTotalUsd: "1.50",
          knownSubtotalUsd: "1.50",
        },
      }),
    );
    assert.ok(el.querySelectorAll(".bg-bento-card").length >= 2);
    assert.match(el.textContent ?? "", /24/);
    assert.match(el.textContent ?? "", /156,000/);
  });
});
