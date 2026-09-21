import type {
  BillingAdminDashboard,
  BillingAdminExportQuery,
  BillingAdminExportReport,
  BillingAdminGateway,
  BillingAdminPeriod,
  BillingAdminPaymentFilter,
} from "@lcsp/contracts/billing";
import {
  BILLING_ERROR_CODES,
  billingAdminDashboardQuerySchema,
  billingAdminDashboardSchema,
  billingAdminExportQuerySchema,
  billingAdminExportReportSchema,
} from "@lcsp/contracts/billing";
import { apiRequest } from "./api-request";

export type AdminBillingQuery = {
  period: BillingAdminPeriod;
  status: BillingAdminPaymentFilter;
  gateway: BillingAdminGateway;
  page: number;
  pageSize: number;
};

export async function fetchAdminBilling(
  query: AdminBillingQuery,
): Promise<BillingAdminDashboard> {
  const queryResult = billingAdminDashboardQuerySchema.safeParse(query);
  if (!queryResult.success) {
    throw new Error(BILLING_ERROR_CODES.validationFailed);
  }
  const validatedQuery = queryResult.data;
  const params = new URLSearchParams({
    period: validatedQuery.period,
    status: validatedQuery.status,
    gateway: validatedQuery.gateway,
    page: String(validatedQuery.page),
    pageSize: String(validatedQuery.pageSize),
  });
  const response = await apiRequest(`/api/admin/billing?${params}`);
  if (!response.ok) {
    throw new Error(response.problemCode ?? "ADMIN_BILLING_FAILED");
  }
  const payload = billingAdminDashboardSchema.safeParse(response.payload);
  if (!payload.success) {
    throw new Error(BILLING_ERROR_CODES.validationFailed);
  }
  return payload.data;
}

export async function fetchAdminBillingExport(
  query: BillingAdminExportQuery,
): Promise<BillingAdminExportReport> {
  const queryResult = billingAdminExportQuerySchema.safeParse(query);
  if (!queryResult.success) {
    throw new Error(BILLING_ERROR_CODES.validationFailed);
  }
  const validatedQuery = queryResult.data;
  const params = new URLSearchParams({
    period: validatedQuery.period,
    status: validatedQuery.status,
    gateway: validatedQuery.gateway,
  });
  const response = await apiRequest(`/api/admin/billing/export?${params}`);
  if (!response.ok) {
    throw new Error(response.problemCode ?? "ADMIN_BILLING_FAILED");
  }
  const payload = billingAdminExportReportSchema.safeParse(response.payload);
  if (!payload.success) {
    throw new Error(BILLING_ERROR_CODES.validationFailed);
  }
  return payload.data;
}
