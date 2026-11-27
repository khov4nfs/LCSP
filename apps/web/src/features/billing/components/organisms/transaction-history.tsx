"use client";

import {
  BILLING_ORDER_STATUSES,
  type BillingOrderView,
} from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";

import { PaymentStatusBadge } from "../molecules/payment-status-badge";

type TransactionHistoryProps = {
  locale: Locale;
  orders: BillingOrderView[];
  page: number;
  pageSize: number;
  totalCount: number;
  isFetching: boolean;
  previousLabel: string;
  nextLabel: string;
  formatAmount: (value: string) => string;
  formatDate: (value: string) => string;
  onPageChange: (page: number) => void;
  onOpenOrder: (orderId: string) => void;
};

/**
 * Business purpose: Render the paginated customer top-up transaction history table aligned to Figma master 1682:1261 (LCSP Data / Table row / payment).
 * Business rules:
 * - Shows empty state when no orders exist and exposes view actions only for actionable pending/reconciliation orders.
 * - Preserves server pagination bounds and disables navigation while fetching.
 * Execution flow:
 * 1. Render table rows with status indicator dot, formatted date, tabular VND amount, monospace payment code, and PaymentStatusBadge.
 * 2. Render pagination controls when totalCount > 0.
 * Failure cases:
 * - Empty orders array renders localized empty-state copy without crashing.
 * Side effects:
 * - Triggers onPageChange and onOpenOrder callbacks for parent query state updates.
 */
export function TransactionHistory({
  locale,
  orders,
  page,
  pageSize,
  totalCount,
  isFetching,
  previousLabel,
  nextLabel,
  formatAmount,
  formatDate,
  onPageChange,
  onOpenOrder,
}: TransactionHistoryProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <section
      aria-labelledby="billing-history-heading"
      className="mt-4"
      data-component="TransactionHistory"
    >
      <h3 id="billing-history-heading" className="text-sm font-medium">
        {resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.historyTitle",
        )}
      </h3>
      {orders.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border/70 p-5 text-xs text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.historyEmpty",
          )}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-border/70 bg-background">
          <table className="w-full min-w-145 text-left text-xs">
            <caption className="sr-only">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.historyTitle",
              )}
            </caption>
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.createdAt",
                  )}
                </th>
                <th className="px-4 py-3 font-medium">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.orderAmount",
                  )}
                </th>
                <th className="px-4 py-3 font-medium">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.paymentCode",
                  )}
                </th>
                <th className="px-4 py-3 font-medium">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.statusLabel",
                  )}
                </th>
                <th className="px-4 py-3 font-medium">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.historyActions",
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-border/70">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {formatDate(order.createdAt)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {formatAmount(order.amountVnd)}
                  </td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    {order.paymentCode}
                  </td>
                  <td className="px-4 py-3">
                    <PaymentStatusBadge
                      locale={locale}
                      status={order.status}
                      showDot
                    />
                  </td>
                  <td className="px-4 py-3">
                    {order.status === BILLING_ORDER_STATUSES.PENDING_PAYMENT ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        aria-label={`${resolveMessage(locale, "pages.workspace.settingsHub.billing.viewPayment")} ${order.paymentCode}`}
                        onClick={() => onOpenOrder(order.id)}
                      >
                        {resolveMessage(
                          locale,
                          "pages.workspace.settingsHub.billing.viewPayment",
                        )}
                      </Button>
                    ) : order.status ===
                      BILLING_ORDER_STATUSES.PENDING_RECONCILIATION ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        aria-label={`${resolveMessage(locale, "pages.workspace.settingsHub.billing.viewOrder")} ${order.paymentCode}`}
                        onClick={() => onOpenOrder(order.id)}
                      >
                        {resolveMessage(
                          locale,
                          "pages.workspace.settingsHub.billing.viewOrder",
                        )}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {totalCount > 0 ? (
        <nav
          aria-label={resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.historyTitle",
          )}
          className="mt-3 flex flex-wrap items-center justify-end gap-3"
        >
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.historyPage",
            )}{" "}
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || isFetching}
            onClick={() => onPageChange(page - 1)}
          >
            {previousLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isFetching}
            onClick={() => onPageChange(page + 1)}
          >
            {nextLabel}
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
