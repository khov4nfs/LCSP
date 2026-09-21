import {
  BILLING_ERROR_CODES,
  billingAmountVndSchema,
  billingCreateOrderSchema,
  billingHistoryQuerySchema,
  billingHistoryViewSchema,
  billingIdempotencyKeySchema,
  billingOrderViewSchema,
  billingResourceIdSchema,
  billingUsageEstimateSchema,
  billingWalletViewSchema,
  type BillingHistoryView,
  type BillingOrderView,
  type BillingUsageEstimate,
  type BillingWalletView,
} from "@lcsp/contracts/billing";
import type { ZodType } from "zod";

import { apiRequest } from "./api-request";

export class BillingRequestError extends Error {
  readonly problemCode: string | undefined;

  constructor(problemCode?: string) {
    super("billing-request-failed");
    this.problemCode = problemCode;
  }
}

export async function getBillingWallet(): Promise<BillingWalletView> {
  return request("/api/billing/wallet", billingWalletViewSchema);
}

export async function getBillingEstimate(
  amountVnd: string,
): Promise<BillingUsageEstimate> {
  const validatedAmount = parseInput(billingAmountVndSchema, amountVnd);
  return request(
    `/api/billing/estimate?amount_vnd=${encodeURIComponent(validatedAmount)}`,
    billingUsageEstimateSchema,
  );
}

export async function createBillingOrder(input: {
  amountVnd: string;
  idempotencyKey: string;
}): Promise<BillingOrderView> {
  const body = parseInput(billingCreateOrderSchema, {
    amount_vnd: input.amountVnd,
  });
  const idempotencyKey = billingIdempotencyKeySchema.safeParse(
    input.idempotencyKey,
  );
  if (!idempotencyKey.success) {
    throw new BillingRequestError(BILLING_ERROR_CODES.idempotencyKeyRequired);
  }
  return request("/api/billing/orders", billingOrderViewSchema, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey.data,
    },
    body: JSON.stringify(body),
  });
}

export async function getBillingOrder(
  orderId: string,
): Promise<BillingOrderView> {
  const validatedOrderId = parseInput(billingResourceIdSchema, orderId);
  return request(
    `/api/billing/orders/${encodeURIComponent(validatedOrderId)}`,
    billingOrderViewSchema,
  );
}

export async function getBillingHistory(input?: {
  page?: number;
  pageSize?: number;
}): Promise<BillingHistoryView> {
  const pagination = parseInput(billingHistoryQuerySchema, {
    page: input?.page,
    page_size: input?.pageSize,
  });
  const params = new URLSearchParams({
    page: String(pagination.page),
    page_size: String(pagination.page_size),
  });
  return request(`/api/billing/history?${params}`, billingHistoryViewSchema);
}

async function request<TData>(
  path: string,
  schema: ZodType<TData>,
  init?: RequestInit,
): Promise<TData> {
  const response = await apiRequest(path, init);
  const parsed = response.ok ? schema.safeParse(response.payload) : null;
  if (!response.ok || !parsed?.success) {
    throw new BillingRequestError(response.problemCode);
  }
  return parsed.data;
}

function parseInput<TData>(schema: ZodType<TData>, value: unknown): TData {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BillingRequestError(BILLING_ERROR_CODES.validationFailed);
  }
  return parsed.data;
}
