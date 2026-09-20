import {
  BILLING_ESTIMATE_AVAILABILITY,
  BILLING_ORDER_STATUSES,
  BILLING_PAYMENT_PROVIDERS,
  PREPAID_BILLING_CONFIG,
  type BillingHistoryView,
  type BillingOrderView,
  type BillingUsageEstimate,
  type BillingWalletView,
} from "@lcsp/contracts/billing";

import { apiRequest } from "./api-request";

export class BillingRequestError extends Error {
  readonly problemCode: string | undefined;

  constructor(problemCode?: string) {
    super("billing-request-failed");
    this.problemCode = problemCode;
  }
}

export async function getBillingWallet(): Promise<BillingWalletView> {
  return request("/api/billing/wallet", isWallet);
}

export async function getBillingEstimate(
  amountVnd: string,
): Promise<BillingUsageEstimate> {
  return request(
    `/api/billing/estimate?amount_vnd=${encodeURIComponent(amountVnd)}`,
    isEstimate,
  );
}

export async function createBillingOrder(input: {
  amountVnd: string;
  idempotencyKey: string;
}): Promise<BillingOrderView> {
  return request("/api/billing/orders", isOrder, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({ amount_vnd: input.amountVnd }),
  });
}

export async function getBillingOrder(
  orderId: string,
): Promise<BillingOrderView> {
  return request(`/api/billing/orders/${encodeURIComponent(orderId)}`, isOrder);
}

export async function getBillingHistory(input?: {
  page?: number;
  pageSize?: number;
}): Promise<BillingHistoryView> {
  const params = new URLSearchParams({
    page: String(input?.page ?? 1),
    page_size: String(input?.pageSize ?? 20),
  });
  return request(`/api/billing/history?${params}`, isHistory);
}

async function request<T>(
  path: string,
  guard: (value: unknown) => value is T,
  init?: RequestInit,
): Promise<T> {
  const response = await apiRequest(path, init);
  if (!response.ok || !guard(response.payload)) {
    throw new BillingRequestError(response.problemCode);
  }
  return response.payload;
}

function isWallet(value: unknown): value is BillingWalletView {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.walletId === "string" &&
    typeof item.availableCredits === "string" &&
    typeof item.reservedCredits === "string" &&
    typeof item.totalCredits === "string" &&
    typeof item.version === "number"
  );
}

function isEstimate(value: unknown): value is BillingUsageEstimate {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const runtime = item.effectiveRuntimeModel;
  return (
    item.currency === PREPAID_BILLING_CONFIG.currency &&
    typeof item.amountVnd === "string" &&
    typeof item.creditUnits === "string" &&
    typeof item.expiresInHours === "number" &&
    (item.availability === BILLING_ESTIMATE_AVAILABILITY.available ||
      item.availability ===
        BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration) &&
    (runtime === null || isRuntimeModel(runtime)) &&
    (typeof item.estimatedUsageChargeVnd === "string" ||
      item.estimatedUsageChargeVnd === null)
  );
}

function isRuntimeModel(value: unknown) {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.provider === "string" &&
    typeof item.model === "string" &&
    typeof item.policyVersion === "string" &&
    typeof item.effectiveAt === "string"
  );
}

function isOrder(value: unknown): value is BillingOrderView {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const instructions = item.paymentInstructions;
  return (
    typeof item.id === "string" &&
    typeof item.amountVnd === "string" &&
    typeof item.creditUnits === "string" &&
    typeof item.paymentCode === "string" &&
    Object.values(BILLING_ORDER_STATUSES).includes(
      item.status as (typeof BILLING_ORDER_STATUSES)[keyof typeof BILLING_ORDER_STATUSES],
    ) &&
    (typeof item.expiresAt === "string" || item.expiresAt === null) &&
    (typeof item.creditedAt === "string" || item.creditedAt === null) &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    isPaymentInstructions(instructions)
  );
}

function isPaymentInstructions(value: unknown) {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item.provider === BILLING_PAYMENT_PROVIDERS.sepay &&
    item.currency === PREPAID_BILLING_CONFIG.currency &&
    typeof item.paymentCode === "string" &&
    typeof item.amountVnd === "string" &&
    typeof item.bankName === "string" &&
    typeof item.bankAccountNumber === "string" &&
    typeof item.accountHolder === "string" &&
    typeof item.transferContent === "string" &&
    typeof item.qrCodeUrl === "string"
  );
}

function isHistory(value: unknown): value is BillingHistoryView {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    Array.isArray(item.orders) &&
    item.orders.every(isOrder) &&
    typeof item.page === "number" &&
    typeof item.pageSize === "number" &&
    typeof item.totalCount === "number"
  );
}
