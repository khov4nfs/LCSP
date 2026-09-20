import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import {
  BILLING_ESTIMATE_AVAILABILITY,
  BILLING_ORDER_STATUSES,
  BILLING_PAYMENT_PROVIDERS,
  PREPAID_BILLING_CONFIG,
} from "@lcsp/contracts/billing";
import type {
  BillingHistoryView,
  BillingOrderView,
  BillingWalletView,
} from "@lcsp/contracts/billing";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const testWindow = dom.window;
for (const name of [
  "window",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "MutationObserver",
  "getComputedStyle",
] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? testWindow : testWindow[name],
  });
}
for (const name of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: testWindow[name].bind(testWindow),
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
Object.defineProperty(testWindow, "matchMedia", {
  configurable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
});

const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { apiQueryKeys } = await import("../src/lib/api/query-keys.ts");
const { BillingSettingsPanel } =
  await import("../src/features/billing/components/organisms/billing-settings-panel.tsx");

type BillingFixture = {
  orders: BillingOrderView[];
  wallet: BillingWalletView;
  walletCalls: number;
  walletResponses: BillingWalletView[];
  deferWalletResponses: boolean;
  pendingWalletResolvers: Array<(response: BillingWalletView) => void>;
  historyCalls: number;
  orderCalls: Map<string, number>;
  missingOrderDetails: Set<string>;
  createRequests: Array<{ amountVnd: string; idempotencyKey: string }>;
};

function order(
  id: string,
  status: BillingOrderView["status"],
  createdAt: string,
  amountVnd = "10000",
): BillingOrderView {
  return {
    id,
    amountVnd,
    creditUnits: amountVnd,
    paymentCode: `LCSP${id.toUpperCase()}`,
    status,
    expiresAt: "2026-09-20T00:00:00.000Z",
    creditedAt:
      status === BILLING_ORDER_STATUSES.CREDITED
        ? "2026-09-19T01:00:00.000Z"
        : null,
    createdAt,
    updatedAt: createdAt,
    paymentInstructions: {
      provider: BILLING_PAYMENT_PROVIDERS.sepay,
      currency: PREPAID_BILLING_CONFIG.currency,
      paymentCode: `LCSP${id.toUpperCase()}`,
      amountVnd,
      bankName: "Example Bank",
      bankAccountNumber: "0123456789",
      accountHolder: "LCSP",
      transferContent: `LCSP${id.toUpperCase()}`,
      qrCodeUrl: "",
    },
  };
}

function wallet(availableCredits: string): BillingWalletView {
  return {
    walletId: "wallet-current-user",
    availableCredits,
    reservedCredits: "0",
    totalCredits: availableCredits,
    version: Number(availableCredits),
  };
}

function success(data: unknown) {
  return Response.json({ ok: true, data });
}

function historyView(orders: BillingOrderView[]): BillingHistoryView {
  return { orders, page: 1, pageSize: 20, totalCount: orders.length };
}

function mockBillingApi(fixture: BillingFixture) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/billing/wallet") {
      fixture.walletCalls += 1;
      if (fixture.deferWalletResponses) {
        return new Promise<Response>((resolve) => {
          fixture.pendingWalletResolvers.push((response) =>
            resolve(success(response)),
          );
        });
      }
      return success(
        fixture.walletResponses[fixture.walletCalls - 1] ?? fixture.wallet,
      );
    }
    if (path.startsWith("/api/billing/history")) {
      fixture.historyCalls += 1;
      return success(historyView(fixture.orders));
    }
    if (path.startsWith("/api/billing/estimate?")) {
      const amountVnd = new URL(path, "http://localhost").searchParams.get(
        "amount_vnd",
      );
      assert.ok(amountVnd);
      return success({
        currency: PREPAID_BILLING_CONFIG.currency,
        amountVnd,
        creditUnits: amountVnd,
        expiresInHours: PREPAID_BILLING_CONFIG.orderExpiryHours,
        availability:
          BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration,
        effectiveRuntimeModel: null,
        estimatedUsageChargeVnd: null,
      });
    }
    if (path === "/api/billing/orders" && init?.method === "POST") {
      const payload = JSON.parse(String(init.body)) as { amount_vnd: string };
      const idempotencyKey = new Headers(init.headers).get("idempotency-key");
      assert.ok(idempotencyKey);
      fixture.createRequests.push({
        amountVnd: payload.amount_vnd,
        idempotencyKey,
      });
      const existingRequest = fixture.createRequests
        .slice(0, -1)
        .find((request) => request.idempotencyKey === idempotencyKey);
      if (existingRequest) {
        const existingOrder = fixture.orders.find(
          (candidate) => candidate.amountVnd === existingRequest.amountVnd,
        );
        assert.ok(existingOrder, "idempotent replay should find its order");
        return success(existingOrder);
      }
      const createdOrder = order(
        `created-${fixture.createRequests.length}`,
        BILLING_ORDER_STATUSES.PENDING_PAYMENT,
        "2026-09-19T04:00:00.000Z",
        payload.amount_vnd,
      );
      fixture.orders = [createdOrder, ...fixture.orders];
      return success(createdOrder);
    }
    const orderId = path.match(/^\/api\/billing\/orders\/([^/?]+)/)?.[1];
    if (orderId) {
      fixture.orderCalls.set(
        orderId,
        (fixture.orderCalls.get(orderId) ?? 0) + 1,
      );
      if (fixture.missingOrderDetails.has(orderId)) {
        return Response.json(
          { ok: false, problem: { code: "BILLING_NOT_FOUND" } },
          { status: 404 },
        );
      }
      const found = fixture.orders.find((item) => item.id === orderId);
      assert.ok(found, `unexpected billing order request for ${orderId}`);
      return success(found);
    }
    throw new Error(`Unexpected billing API request: ${path}`);
  };
}

async function renderBilling(
  fixture: BillingFixture,
  context: { after(callback: () => void | Promise<void>): void },
  seededOrder?: BillingOrderView,
) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockBillingApi(fixture);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  if (seededOrder) {
    queryClient.setQueryData(
      apiQueryKeys.billing.order(seededOrder.id),
      seededOrder,
    );
  }
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  const root = createRoot(container);
  context.after(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    globalThis.fetch = previousFetch;
    container.remove();
  });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(BillingSettingsPanel, { locale: "en" }),
      ),
    );
  });
  return container;
}

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 2_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) assert.fail(message);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function setAmount(container: HTMLElement, amount: string) {
  const input = container.querySelector<HTMLInputElement>(
    "#billing-amount-vnd",
  );
  assert.ok(input);
  const setValue = Object.getOwnPropertyDescriptor(
    testWindow.HTMLInputElement.prototype,
    "value",
  )?.set;
  assert.ok(setValue);
  await act(async () => {
    setValue.call(input, amount);
    input.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
    input.dispatchEvent(new testWindow.Event("change", { bubbles: true }));
  });
}

async function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(button, `expected button: ${label}`);
  await act(async () => button.click());
}

function fixtureFor(
  orders: BillingOrderView[],
  balance = "10000",
): BillingFixture {
  return {
    orders,
    wallet: wallet(balance),
    walletCalls: 0,
    walletResponses: [],
    deferWalletResponses: false,
    pendingWalletResolvers: [],
    historyCalls: 0,
    orderCalls: new Map(),
    missingOrderDetails: new Set(),
    createRequests: [],
  };
}

async function assertLifecycleStatus(
  context: { after(callback: () => void | Promise<void>): void },
  id: string,
  status: BillingOrderView["status"],
  visible: string,
) {
  const currentOrder = order(id, status, "2026-09-19T01:00:00.000Z");
  const container = await renderBilling(
    fixtureFor([currentOrder], "23000"),
    context,
  );
  await waitFor(
    () => container.textContent?.includes(visible) ?? false,
    `expected visible status: ${visible}`,
  );
  assert.match(container.textContent ?? "", /23,000 VND/);
  assert.match(
    container.textContent ?? "",
    new RegExp(currentOrder.paymentCode),
  );
}

test("Billing Settings visibly renders a pending payment", async (context) => {
  await assertLifecycleStatus(
    context,
    "pending",
    BILLING_ORDER_STATUSES.PENDING_PAYMENT,
    "Pending payment",
  );
});

test("Billing Settings visibly renders credited state", async (context) => {
  await assertLifecycleStatus(
    context,
    "credited",
    BILLING_ORDER_STATUSES.CREDITED,
    "Credited",
  );
});

test("Billing Settings visibly renders expired state", async (context) => {
  await assertLifecycleStatus(
    context,
    "expired",
    BILLING_ORDER_STATUSES.EXPIRED,
    "Expired",
  );
});

test("Billing Settings visibly renders pending reconciliation", async (context) => {
  await assertLifecycleStatus(
    context,
    "reconciliation",
    BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
    "Payment pending reconciliation",
  );
});

test("order-detail 404 falls back to authenticated history and stops retry polling", async (context) => {
  const currentOrder = order(
    "history-fallback",
    BILLING_ORDER_STATUSES.PENDING_PAYMENT,
    "2026-09-19T01:00:00.000Z",
  );
  const fixture = fixtureFor([currentOrder]);
  fixture.missingOrderDetails.add(currentOrder.id);
  const container = await renderBilling(fixture, context, currentOrder);

  await waitFor(
    () =>
      fixture.orderCalls.get(currentOrder.id) === 1 &&
      container.textContent?.includes("Pending payment") === true,
    "expected history to keep the payment visible after detail 404",
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  assert.equal(
    fixture.orderCalls.get(currentOrder.id),
    1,
    "not-found details must not repeatedly poll a stale cached order",
  );
  assert.match(
    container.textContent ?? "",
    new RegExp(currentOrder.paymentCode),
  );
});

test("a pending history order can be reopened to show its own payment instructions", async (context) => {
  const newestOrder = order(
    "newest-order",
    BILLING_ORDER_STATUSES.PENDING_PAYMENT,
    "2026-09-19T02:00:00.000Z",
  );
  const olderOrder = order(
    "older-order",
    BILLING_ORDER_STATUSES.PENDING_PAYMENT,
    "2026-09-19T01:00:00.000Z",
  );
  const fixture = fixtureFor([newestOrder, olderOrder]);
  const container = await renderBilling(fixture, context);
  await waitFor(
    () => container.querySelectorAll("tbody tr").length === 2,
    "expected both pending orders to appear in history",
  );
  const olderRow = [...container.querySelectorAll("tbody tr")].find((row) =>
    row.textContent?.includes(olderOrder.paymentCode),
  );
  const openButton = olderRow?.querySelector("button");
  assert.ok(openButton, "pending history row should expose an open action");

  await act(async () => openButton.click());
  await waitFor(
    () =>
      (fixture.orderCalls.get(olderOrder.id) ?? 0) > 0 &&
      (container
        .querySelector('[aria-labelledby="billing-order-heading"]')
        ?.textContent?.includes(olderOrder.paymentCode) ??
        false),
    "expected the selected history order payment details to reopen",
  );
});

test("creating another order requires confirmation while an order is pending", async (context) => {
  const existingOrder = order(
    "existing-order",
    BILLING_ORDER_STATUSES.PENDING_PAYMENT,
    "2026-09-19T01:00:00.000Z",
  );
  const fixture = fixtureFor([existingOrder]);
  const container = await renderBilling(fixture, context);
  await waitFor(
    () => container.querySelector("#billing-amount-vnd") !== null,
    "expected the top-up form to finish loading",
  );

  await setAmount(container, "20000");
  await clickButton(container, "Create another order");
  assert.equal(fixture.createRequests.length, 0);
  assert.match(
    container.textContent ?? "",
    /You already have an order awaiting payment or reconciliation/,
  );
  assert.match(
    container.textContent ?? "",
    /paying both can credit both orders/,
  );

  await clickButton(container, "Confirm another order");
  await waitFor(
    () => fixture.createRequests.length === 1,
    "expected explicit confirmation to create a new order",
  );
  assert.equal(fixture.createRequests[0]?.amountVnd, "20000");
  assert.ok(fixture.createRequests[0]?.idempotencyKey);
});

test("successful top-up clears the amount and a new submission starts a new intent", async (context) => {
  const fixture = fixtureFor([]);
  const container = await renderBilling(fixture, context);
  await waitFor(
    () => container.querySelector("#billing-amount-vnd") !== null,
    "expected the top-up form to finish loading",
  );

  await setAmount(container, "20000");
  await clickButton(container, "Create payment order");
  await waitFor(
    () => fixture.createRequests.length === 1 && fixture.orders.length === 1,
    "expected the first submit to create one server order",
  );
  await waitFor(
    () =>
      container.querySelector<HTMLInputElement>("#billing-amount-vnd")
        ?.value === "",
    "successful order creation should clear the amount input",
  );

  await clickButton(container, "Create another order");
  assert.equal(
    fixture.createRequests.length,
    1,
    "submitting the reset empty form must not create another order",
  );

  await setAmount(container, "20000");
  await clickButton(container, "Create another order");
  await clickButton(container, "Confirm another order");
  await waitFor(
    () => fixture.createRequests.length === 2 && fixture.orders.length === 2,
    "expected a deliberately entered new amount to create another order",
  );

  assert.notEqual(
    fixture.createRequests[1]?.idempotencyKey,
    fixture.createRequests[0]?.idempotencyKey,
    "a new top-up intent should use a fresh idempotency key",
  );
});

test("a credited non-selected order refreshes history and prepaid balance while the selected order stays pending", async (context) => {
  const selectedOrder = order(
    "newer",
    BILLING_ORDER_STATUSES.PENDING_PAYMENT,
    "2026-09-19T02:00:00.000Z",
  );
  const otherPendingOrder = order(
    "older",
    BILLING_ORDER_STATUSES.PENDING_PAYMENT,
    "2026-09-19T01:00:00.000Z",
  );
  const fixture = fixtureFor([selectedOrder, otherPendingOrder], "10000");
  const container = await renderBilling(fixture, context);

  await waitFor(
    () => fixture.historyCalls > 0 && fixture.orderCalls.has("newer"),
    "expected initial history and selected-order requests",
  );
  assert.match(container.textContent ?? "", /Pending payment/);

  fixture.orders = [
    selectedOrder,
    {
      ...otherPendingOrder,
      status: BILLING_ORDER_STATUSES.CREDITED,
      creditedAt: "2026-09-19T03:00:00.000Z",
      updatedAt: "2026-09-19T03:00:00.000Z",
    },
  ];
  fixture.wallet = wallet("20000");

  await waitFor(
    () =>
      fixture.historyCalls > 1 &&
      (fixture.orderCalls.get("newer") ?? 0) > 1 &&
      container.textContent?.includes("20,000 VND") === true &&
      container.textContent?.includes("Credited") === true,
    "history and selected-order polling should refresh after the other settlement",
    12_000,
  );
  const olderRow = [...container.querySelectorAll("tbody tr")].find((row) =>
    row.textContent?.includes(otherPendingOrder.paymentCode),
  );
  assert.match(olderRow?.textContent ?? "", /Credited/);
  assert.match(container.textContent ?? "", /Pending payment/);
});

test("initial history showing a credited order refreshes an older wallet snapshot once", async (context) => {
  const creditedOrder = order(
    "credited-before-first-history",
    BILLING_ORDER_STATUSES.CREDITED,
    "2026-09-19T01:00:00.000Z",
  );
  const fixture = fixtureFor([creditedOrder], "10000");
  fixture.walletResponses = [wallet("10000"), wallet("20000")];
  const container = await renderBilling(fixture, context);

  await waitFor(
    () =>
      fixture.historyCalls > 0 &&
      fixture.walletCalls === 2 &&
      container.textContent?.includes("Credited") === true &&
      container.textContent?.includes("20,000 VND") === true,
    "initial credited history should trigger a wallet refresh",
  );
  assert.equal(
    fixture.walletCalls,
    2,
    "initial history synchronization should refresh the wallet only once",
  );
});

test("history completing before the initial wallet triggers a fresh wallet request after that snapshot", async (context) => {
  const creditedOrder = order(
    "history-first-credit",
    BILLING_ORDER_STATUSES.CREDITED,
    "2026-09-19T01:00:00.000Z",
  );
  const fixture = fixtureFor([creditedOrder], "10000");
  fixture.deferWalletResponses = true;
  const container = await renderBilling(fixture, context);

  await waitFor(
    () => fixture.walletCalls === 1 && fixture.historyCalls === 1,
    "expected the initial wallet and history requests to start",
  );

  const resolveInitialWallet = fixture.pendingWalletResolvers[0];
  assert.ok(resolveInitialWallet, "initial wallet request should be pending");
  await act(async () => resolveInitialWallet(wallet("10000")));

  await waitFor(
    () => fixture.walletCalls === 2,
    "history-first ordering should start a second wallet request after the initial response",
  );
  const resolveSynchronizedWallet = fixture.pendingWalletResolvers[1];
  assert.ok(
    resolveSynchronizedWallet,
    "synchronization request should be pending",
  );
  await act(async () => resolveSynchronizedWallet(wallet("20000")));

  await waitFor(
    () =>
      container.textContent?.includes("Credited") === true &&
      container.textContent?.includes("20,000 VND") === true,
    "the panel should show the authoritative credited balance",
  );
  assert.equal(
    fixture.walletCalls,
    2,
    "only one synchronization fetch is needed",
  );
});
