import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ORDER_STATUSES,
  PAYMENT_RECONCILIATION_STATUSES,
  type BillingAdminPaymentRow,
} from "@lcsp/contracts/billing";

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
for (const key of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key].bind(dom.window),
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const { AdminBillingMetricCard } =
  await import("../src/features/admin/components/molecules/admin-billing-metric-card.tsx");
const { AdminBillingTrendCard } =
  await import("../src/features/admin/components/molecules/admin-billing-trend-card.tsx");
const { AdminPaymentStatusBadge } =
  await import("../src/features/admin/components/molecules/admin-payment-status-badge.tsx");
const { AdminPaymentTable } =
  await import("../src/features/admin/components/organisms/admin-payment-table.tsx");
const { PaymentInvestigationDialog } =
  await import("../src/features/admin/components/organisms/payment-investigation-dialog.tsx");
const { AdminPagination } =
  await import("../src/features/admin/components/molecules/admin-pagination.tsx");

function makePaymentRow(
  id: string,
  reconciliationStatus: BillingAdminPaymentRow["reconciliationStatus"],
  orderStatus: NonNullable<BillingAdminPaymentRow["order"]>["status"],
): BillingAdminPaymentRow {
  return {
    id,
    provider: BILLING_ADMIN_GATEWAYS.sepay,
    providerTransactionId: `TX-${id}`,
    amountVnd: "1000000",
    reconciliationStatus,
    reconciliationReason: null,
    reconciledAt: null,
    receivedAt: "2026-11-24T08:00:00.000Z",
    account: {
      userId: `acc-${id}`,
      email: `user-${id}@example.com`,
      displayName: null,
    },
    order: {
      id: `ord-${id}`,
      paymentCode: `LCSP-${id}`,
      creditUnits: "1000000",
      status: orderStatus,
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

describe("Admin Billing UI components (Frames 47-49, 86)", () => {
  it("renders AdminBillingMetricCard in loading and populated states", () => {
    const loadingEl = renderNode(
      createElement(AdminBillingMetricCard, {
        label: "Settled top-ups",
        value: undefined,
        subtitle: "Credited orders",
        isLoading: true,
      }),
    );
    assert.equal(loadingEl.textContent?.includes("₫124,500,000"), false);

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const popEl = renderNode(
      createElement(AdminBillingMetricCard, {
        label: "Settled top-ups",
        value: "₫124,500,000",
        subtitle: "Credited orders",
        isLoading: false,
      }),
    );
    assert.match(popEl.textContent ?? "", /₫124,500,000/);
  });

  it("renders AdminBillingTrendCard with accessible day columns", () => {
    const el = renderNode(
      createElement(AdminBillingTrendCard, {
        trend: [
          { day: "2026-11-23", amountVnd: "0" },
          { day: "2026-11-24", amountVnd: "5000000" },
        ],
      }),
    );
    assert.ok(el.querySelector('[role="img"]'));
    assert.match(
      el.textContent ?? "",
      /(?:Settled top-up trend|Xu hướng nạp tiền đã quyết toán)/,
    );
  });

  it("renders AdminPaymentStatusBadge with semantic success, warning, and danger tokens", () => {
    const matchedEl = renderNode(
      createElement(AdminPaymentStatusBadge, {
        mode: "webhook",
        label: "Matched",
        reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.MATCHED,
      }),
    );
    assert.ok(matchedEl.querySelector(".bg-status-success-bg"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const reviewEl = renderNode(
      createElement(AdminPaymentStatusBadge, {
        mode: "webhook",
        label: "Needs review",
        reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
      }),
    );
    assert.ok(reviewEl.querySelector(".bg-status-warning-bg"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const dupEl = renderNode(
      createElement(AdminPaymentStatusBadge, {
        mode: "order",
        label: "Blocked",
        reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.DUPLICATE,
        orderStatus: BILLING_ORDER_STATUSES.PENDING_PAYMENT,
      }),
    );
    assert.ok(dupEl.querySelector(".bg-status-danger-bg"));
  });

  it("renders AdminPaymentTable with 8 column headers and View/Review actions", () => {
    let selectedId = "";
    const rows = [
      makePaymentRow(
        "101",
        PAYMENT_RECONCILIATION_STATUSES.MATCHED,
        BILLING_ORDER_STATUSES.CREDITED,
      ),
      makePaymentRow(
        "102",
        PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
        BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
      ),
    ];
    const el = renderNode(
      createElement(AdminPaymentTable, {
        items: rows,
        tableAriaLabel: "Admin billing payments",
        columns: {
          order: "Order",
          customer: "Customer account",
          amount: "Amount",
          credits: "Credits",
          gateway: "Gateway",
          webhook: "Webhook",
          status: "Status",
          action: "Action",
        },
        unknownOrderLabel: "Unknown order",
        unknownAccountLabel: "Unknown account",
        sepayNameLabel: "SePay",
        viewActionLabel: "View",
        reviewActionLabel: "Review",
        formatVnd: (v) => (v ? `₫${v}` : "—"),
        getWebhookStatusLabel: (r) => r.reconciliationStatus,
        getOrderStatusLabel: (r) => r.order?.status ?? "PENDING",
        onSelectPayment: (r) => {
          selectedId = r.id;
        },
      }),
    );

    assert.equal(el.querySelectorAll("thead th").length, 8);
    assert.equal(el.querySelectorAll("tbody tr").length, 2);
    const buttons = [...el.querySelectorAll("tbody button")] as HTMLButtonElement[];
    assert.equal(buttons[0]?.textContent, "View");
    assert.equal(buttons[1]?.textContent, "Review");

    act(() => {
      buttons[1]?.click();
    });
    assert.equal(selectedId, "102");
  });

  it("renders PaymentInvestigationDialog without leaking webhook secrets", () => {
    const payment = makePaymentRow(
      "201",
      PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
      BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
    );
    const el = renderNode(
      createElement(PaymentInvestigationDialog, {
        payment,
        closeLabel: "Close",
        description: "Admin billing payments",
        labels: {
          customer: "Customer account",
          amount: "Amount",
          credits: "Credits",
          webhook: "Webhook",
          status: "Status",
          gateway: "Gateway",
        },
        unknownAccountLabel: "Unknown account",
        sepayNameLabel: "SePay",
        formatVnd: (v) => (v ? `₫${v}` : "—"),
        getWebhookStatusLabel: () => "Pending",
        getOrderStatusLabel: () => "Awaiting payment",
        onClose: () => {},
      }),
    );
    const bodyText = document.body.textContent ?? "";
    assert.match(bodyText, /LCSP-201/);
    assert.match(bodyText, /user-201@example\.com/);
    assert.doesNotMatch(
      bodyText,
      /rawBody|signature|webhookSecret|sanitizedPayload/i,
    );
    assert.ok(el);
  });

  it("renders AdminPagination and triggers page change on Next click", () => {
    let nextPage = 0;
    const el = renderNode(
      createElement(AdminPagination, {
        page: 1,
        totalPages: 7,
        disabled: false,
        onPageChange: (p) => {
          nextPage = p;
        },
      }),
    );
    const buttons = [...el.querySelectorAll("button")];
    assert.equal(buttons[0]?.disabled, true);
    assert.equal(buttons[1]?.disabled, false);
    act(() => {
      buttons[1]?.click();
    });
    assert.equal(nextPage, 2);
  });

  it("contains long customer email and order code with right-aligned monetary cells", () => {
    const longRow = makePaymentRow(
      "VERY-LONG-ORDER-REFERENCE-2026-000123456",
      PAYMENT_RECONCILIATION_STATUSES.MATCHED,
      BILLING_ORDER_STATUSES.CREDITED,
    );
    longRow.account = {
      userId: "acc-long",
      email: "very.long.enterprise.billing.account+2026@subdomain.example.com",
      displayName: null,
    };
    const el = renderNode(
      createElement(AdminPaymentTable, {
        items: [longRow],
        tableAriaLabel: "Billing payments",
        columns: {
          order: "Order",
          customer: "Customer account",
          amount: "Amount",
          credits: "Credits",
          gateway: "Gateway",
          webhook: "Webhook",
          status: "Status",
          action: "Action",
        },
        unknownOrderLabel: "Unknown order",
        unknownAccountLabel: "Unknown account",
        sepayNameLabel: "SePay",
        viewActionLabel: "View",
        reviewActionLabel: "Review",
        formatVnd: (v) => (v ? `₫${v}` : "—"),
        getWebhookStatusLabel: (r) => r.reconciliationStatus,
        getOrderStatusLabel: (r) => r.order?.status ?? "PENDING",
        onSelectPayment: () => {},
      }),
    );

    const cells = [...el.querySelectorAll("tbody td")];
    const orderCell = cells[0];
    const customerCell = cells[1];
    const amountCell = cells[2];
    const creditsCell = cells[3];
    const headers = [...el.querySelectorAll("thead th")];

    assert.ok(orderCell?.className.includes("overflow-hidden"));
    assert.ok(customerCell?.className.includes("overflow-hidden"));
    assert.ok(customerCell?.querySelector(".truncate"));
    assert.equal(customerCell?.querySelector("[title]"), null);
    assert.ok(headers[2]?.className.includes("text-right"));
    assert.ok(headers[3]?.className.includes("text-right"));
    assert.ok(amountCell?.className.includes("text-right"));
    assert.ok(creditsCell?.className.includes("text-right"));
  });

  it("does not force dark mode or billing-dark attribute in AdminShell", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const shellSource = readFileSync(
      resolve("apps/web/src/features/admin/components/templates/admin-shell.tsx"),
      "utf8",
    );
    assert.equal(shellSource.includes('isBillingRoute && "dark"'), false);
    assert.equal(shellSource.includes("billing-dark"), false);
  });
});
