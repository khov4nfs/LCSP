"use client";

import { useState } from "react";
import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ADMIN_PERIODS,
  BILLING_ORDER_STATUSES,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";
import type {
  BillingAdminGateway,
  BillingAdminPaymentFilter,
  BillingAdminPaymentRow,
  BillingAdminPeriod,
} from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminPagination } from "../molecules/admin-pagination";
import { AdminBillingMetricCard } from "../molecules/admin-billing-metric-card";
import { AdminBillingPricingPolicyCard } from "../molecules/admin-billing-pricing-policy-card";
import { AdminBillingTrendCard } from "../molecules/admin-billing-trend-card";
import {
  BILLING_ADMIN_FILTER_OPTIONS,
  BILLING_ADMIN_GATEWAY_OPTIONS,
  BILLING_ADMIN_PAGE_SIZE,
  BILLING_ADMIN_PERIOD_OPTIONS,
  BILLING_ADMIN_STATUS_LABEL_KEYS,
} from "../../config/billing-admin.config";
import {
  fetchAdminBillingExport,
  type AdminBillingQuery,
} from "@/lib/api/admin-billing-client";
import { useAdminBillingQuery } from "@/lib/api/admin-billing-queries";
import { resolveAppMessage } from "@/lib/i18n";
import { getAppLocaleSnapshot } from "@/lib/locale";

const NEEDS_REVIEW_STATUSES = [
  PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
  PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
  PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
] as const;

export function AdminBillingPage() {
  const [period, setPeriod] = useState<BillingAdminPeriod>(
    BILLING_ADMIN_PERIODS.mtd,
  );
  const [status, setStatus] = useState<BillingAdminPaymentFilter>(
    BILLING_ADMIN_PAYMENT_FILTERS.all,
  );
  const [gateway, setGateway] = useState<BillingAdminGateway>(
    BILLING_ADMIN_GATEWAYS.sepay,
  );
  const [page, setPage] = useState(1);
  const [selectedPayment, setSelectedPayment] =
    useState<BillingAdminPaymentRow | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const query: AdminBillingQuery = {
    period,
    status,
    gateway,
    page,
    pageSize: BILLING_ADMIN_PAGE_SIZE,
  };
  const { data, isLoading, isError, refetch } = useAdminBillingQuery(query);
  const dashboard = isError ? undefined : data;
  const message = (key: string) => resolveAppMessage(key as MessageKey);
  const formatVnd = (amount: string | undefined) =>
    amount === undefined
      ? "\u2014"
      : `\u20ab${new Intl.NumberFormat(getAppLocaleSnapshot()).format(BigInt(amount))}`;

  async function exportReport() {
    setIsExporting(true);
    setExportFailed(false);
    try {
      const report = await fetchAdminBillingExport({
        period,
        status,
        gateway,
      });
      const rows = report.items;

      const columns = [
        message("pages.admin.billing.columns.order"),
        message("pages.admin.billing.columns.customer"),
        message("pages.admin.billing.columns.amount"),
        message("pages.admin.billing.columns.credits"),
        message("pages.admin.billing.columns.gateway"),
        message("pages.admin.billing.columns.webhook"),
        message("pages.admin.billing.columns.status"),
      ];
      const csvRows = rows.map((item) => [
        item.order?.paymentCode ?? item.providerTransactionId,
        item.account?.email ?? "",
        item.amountVnd,
        item.order?.creditUnits ?? "",
        item.provider,
        item.reconciliationStatus,
        item.order?.status ?? "",
      ]);
      const csv = [columns, ...csvRows]
        .map((row) => row.map(escapeCsvValue).join(","))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `billing-report-${period.toLowerCase()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportFailed(true);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div
      className="space-y-0"
      data-testid="admin-billing-page"
      data-figma-node="1320:2"
    >
      <header>
        <h1 className="text-[32px] leading-9 font-semibold tracking-tight text-foreground">
          {message("pages.admin.billing.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {message("pages.admin.billing.description")}
        </p>
      </header>

      <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap gap-3">
          <label className="sr-only" htmlFor="billing-period">
            {message("pages.admin.billing.periodAria")}
          </label>
          <select
            id="billing-period"
            aria-label={message("pages.admin.billing.periodAria")}
            className="h-12 w-54 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground"
            value={period}
            onChange={(event) => {
              setPeriod(event.currentTarget.value as BillingAdminPeriod);
              setPage(1);
            }}
          >
            {BILLING_ADMIN_PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {message(option.labelKey)}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="billing-status">
            {message("pages.admin.billing.statusAria")}
          </label>
          <select
            id="billing-status"
            aria-label={message("pages.admin.billing.statusAria")}
            className="h-12 w-46 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground"
            value={status}
            onChange={(event) => {
              setStatus(event.currentTarget.value as BillingAdminPaymentFilter);
              setPage(1);
            }}
          >
            {BILLING_ADMIN_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {message(option.labelKey)}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="billing-gateway">
            {message("pages.admin.billing.gatewayAria")}
          </label>
          <select
            id="billing-gateway"
            aria-label={message("pages.admin.billing.gatewayAria")}
            className="h-12 w-54 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground"
            value={gateway}
            onChange={(event) => {
              setGateway(event.currentTarget.value as BillingAdminGateway);
              setPage(1);
            }}
          >
            {BILLING_ADMIN_GATEWAY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {message(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
        <Button
          className="h-12 px-6"
          disabled={isLoading || isError || !dashboard || isExporting}
          onClick={() => void exportReport()}
        >
          {message(
            isExporting
              ? "pages.admin.billing.exporting"
              : "pages.admin.billing.exportReport",
          )}
        </Button>
      </div>

      {isError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{message("pages.admin.billing.errorTitle")}</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{message("pages.admin.billing.errorDescription")}</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {message("pages.admin.billing.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {exportFailed ? (
        <p className="text-sm text-destructive" role="alert">
          {message("pages.admin.billing.exportError")}
        </p>
      ) : null}

      <section
        aria-label={message("pages.admin.billing.title")}
        className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:gap-8"
      >
        <AdminBillingMetricCard
          label={message("pages.admin.billing.metrics.settledTopUps")}
          value={
            dashboard ? formatVnd(dashboard.summary.settledTopUpVnd) : undefined
          }
          subtitle={message("pages.admin.billing.metrics.topUpSubtitle")}
          isLoading={isLoading}
        />
        <AdminBillingMetricCard
          label={message("pages.admin.billing.metrics.usageRevenue")}
          value={
            dashboard ? formatVnd(dashboard.summary.usageRevenueVnd) : undefined
          }
          subtitle={message("pages.admin.billing.metrics.usageSubtitle")}
          isLoading={isLoading}
        />
        <AdminBillingMetricCard
          label={message("pages.admin.billing.metrics.pendingReconciliation")}
          value={
            dashboard
              ? `${dashboard.summary.pendingReconciliationCount} ${message("pages.admin.billing.metrics.eventSuffix")}`
              : undefined
          }
          subtitle={message("pages.admin.billing.status.needsReview")}
          isLoading={isLoading}
        />
        <AdminBillingMetricCard
          label={message("pages.admin.billing.metrics.duplicates")}
          value={
            dashboard
              ? `${dashboard.summary.duplicatePaymentCount} ${message("pages.admin.billing.metrics.eventSuffix")}`
              : undefined
          }
          subtitle={message("pages.admin.billing.status.duplicate")}
          isLoading={isLoading}
        />
      </section>

      <section
        aria-label={message("pages.admin.billing.trend.title")}
        className="mt-9 grid grid-cols-1 gap-5 xl:grid-cols-11 xl:gap-7"
      >
        <div className="xl:col-span-7">
          {dashboard ? (
            <AdminBillingTrendCard
              trend={dashboard.summary.settledTopUpTrend}
            />
          ) : (
            <div className="min-h-53 rounded-xl border border-border bg-card p-4" />
          )}
        </div>
        <div className="xl:col-span-4">
          <AdminBillingPricingPolicyCard />
        </div>
      </section>

      <section className="mt-9 min-h-70 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {isError ? null : !isLoading && dashboard?.items.length === 0 ? (
          <div className="p-10 text-center" data-testid="admin-billing-empty">
            <h2 className="font-medium text-foreground">
              {message("pages.admin.billing.emptyTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {message("pages.admin.billing.emptyDescription")}
            </p>
          </div>
        ) : null}

        {dashboard && dashboard.items.length > 0 ? (
          <div className="overflow-x-auto px-3 pt-2">
            <table
              aria-label={message("pages.admin.billing.tableAria")}
              className="w-full min-w-190 table-fixed text-left text-sm"
            >
              <colgroup>
                <col style={{ width: "14.92%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "11.14%" }} />
                <col style={{ width: "11.4%" }} />
                <col style={{ width: "13.02%" }} />
                <col style={{ width: "14.32%" }} />
                <col style={{ width: "11.72%" }} />
                <col style={{ width: "9.48%" }} />
              </colgroup>
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-3 font-medium">
                    {message("pages.admin.billing.columns.order")}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {message("pages.admin.billing.columns.customer")}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {message("pages.admin.billing.columns.amount")}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {message("pages.admin.billing.columns.credits")}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {message("pages.admin.billing.columns.gateway")}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {message("pages.admin.billing.columns.webhook")}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {message("pages.admin.billing.columns.status")}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {message("pages.admin.billing.columns.action")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dashboard.items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-2 py-4">
                      <div className="font-medium text-foreground">
                        {item.order?.paymentCode ??
                          message("pages.admin.billing.unknownOrder")}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-4 text-muted-foreground">
                      {item.account?.email ??
                        message("pages.admin.billing.unknownAccount")}
                    </td>
                    <td className="whitespace-nowrap px-2 py-4 text-muted-foreground">
                      {formatVnd(item.amountVnd)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-4 text-muted-foreground">
                      {item.order?.creditUnits
                        ? formatVnd(item.order.creditUnits)
                        : "\u2014"}
                    </td>
                    <td className="px-2 py-4 text-muted-foreground">
                      {item.provider === BILLING_ADMIN_GATEWAYS.sepay
                        ? message("pages.admin.billing.gateways.sepayName")
                        : item.provider}
                    </td>
                    <td className="px-2 py-4 text-muted-foreground">
                      {webhookStatusLabel(item, message)}
                    </td>
                    <td className="px-2 py-4 text-muted-foreground">
                      {orderStatusLabel(item, message)}
                    </td>
                    <td className="px-2 py-4">
                      <Button
                        className="h-auto px-0 text-muted-foreground hover:text-foreground"
                        variant="link"
                        size="sm"
                        onClick={() => setSelectedPayment(item)}
                      >
                        {NEEDS_REVIEW_STATUSES.includes(
                          item.reconciliationStatus as (typeof NEEDS_REVIEW_STATUSES)[number],
                        )
                          ? message("pages.admin.billing.actions.review")
                          : message("pages.admin.billing.actions.view")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {isLoading ? (
          <div
            className="p-10 text-center text-sm text-muted-foreground"
            role="status"
          >
            {message("pages.admin.billing.loading")}
          </div>
        ) : null}
      </section>

      <p className="mt-4 text-sm text-muted-foreground">
        {message("pages.admin.billing.footer")}
      </p>

      {dashboard ? (
        <div className="mt-4" data-testid="admin-billing-pagination">
          <AdminPagination
            page={dashboard.page}
            totalPages={Math.max(
              1,
              Math.ceil(dashboard.totalCount / dashboard.pageSize),
            )}
            disabled={isLoading}
            onPageChange={setPage}
          />
        </div>
      ) : null}

      <Dialog
        open={selectedPayment !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPayment(null);
        }}
      >
        <DialogContent
          closeLabel={message("pages.admin.billing.actions.close")}
        >
          {selectedPayment ? (
            <>
              <DialogHeader>
                <div className="space-y-2">
                  <DialogTitle>
                    {selectedPayment.order?.paymentCode ??
                      selectedPayment.providerTransactionId}
                  </DialogTitle>
                  <DialogDescription>
                    {message("pages.admin.billing.tableAria")}
                  </DialogDescription>
                </div>
              </DialogHeader>
              <DialogBody className="grid grid-cols-2 gap-4 text-sm">
                <PaymentDetail
                  label={message("pages.admin.billing.columns.customer")}
                  value={
                    selectedPayment.account?.email ??
                    message("pages.admin.billing.unknownAccount")
                  }
                />
                <PaymentDetail
                  label={message("pages.admin.billing.columns.amount")}
                  value={formatVnd(selectedPayment.amountVnd)}
                />
                <PaymentDetail
                  label={message("pages.admin.billing.columns.credits")}
                  value={
                    selectedPayment.order?.creditUnits
                      ? formatVnd(selectedPayment.order.creditUnits)
                      : "\u2014"
                  }
                />
                <PaymentDetail
                  label={message("pages.admin.billing.columns.webhook")}
                  value={webhookStatusLabel(selectedPayment, message)}
                />
                <PaymentDetail
                  label={message("pages.admin.billing.columns.status")}
                  value={orderStatusLabel(selectedPayment, message)}
                />
                <PaymentDetail
                  label={message("pages.admin.billing.columns.gateway")}
                  value={
                    selectedPayment.provider === BILLING_ADMIN_GATEWAYS.sepay
                      ? message("pages.admin.billing.gateways.sepayName")
                      : selectedPayment.provider
                  }
                />
              </DialogBody>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function webhookStatusLabel(
  item: BillingAdminPaymentRow,
  message: (key: string) => string,
) {
  if (item.reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.MATCHED) {
    return message(BILLING_ADMIN_STATUS_LABEL_KEYS.MATCHED);
  }
  if (item.reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.DUPLICATE) {
    return message(BILLING_ADMIN_STATUS_LABEL_KEYS.DUPLICATE);
  }
  if (
    NEEDS_REVIEW_STATUSES.includes(
      item.reconciliationStatus as (typeof NEEDS_REVIEW_STATUSES)[number],
    )
  ) {
    return message("pages.admin.billing.orderStatus.pending");
  }
  return message(BILLING_ADMIN_STATUS_LABEL_KEYS[item.reconciliationStatus]);
}

function orderStatusLabel(
  item: BillingAdminPaymentRow,
  message: (key: string) => string,
) {
  if (item.reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.DUPLICATE) {
    return message("pages.admin.billing.orderStatus.blocked");
  }
  switch (item.order?.status) {
    case BILLING_ORDER_STATUSES.CREDITED:
      return message("pages.admin.billing.orderStatus.credited");
    case BILLING_ORDER_STATUSES.PENDING_PAYMENT:
    case BILLING_ORDER_STATUSES.PENDING_RECONCILIATION:
      return message("pages.admin.billing.orderStatus.awaiting");
    case BILLING_ORDER_STATUSES.EXPIRED:
      return message("pages.admin.billing.orderStatus.expired");
    case BILLING_ORDER_STATUSES.CANCELLED:
      return message("pages.admin.billing.orderStatus.cancelled");
    default:
      return message("pages.admin.billing.orderStatus.pending");
  }
}

function PaymentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words font-medium text-foreground">{value}</div>
    </div>
  );
}

function escapeCsvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
