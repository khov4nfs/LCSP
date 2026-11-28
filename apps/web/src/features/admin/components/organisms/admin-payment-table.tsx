import {
  BILLING_ADMIN_GATEWAYS,
  PAYMENT_RECONCILIATION_STATUSES,
  type BillingAdminPaymentRow,
} from "@lcsp/contracts/billing";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AdminPaymentRow } from "../molecules/admin-payment-row";

const NEEDS_REVIEW_STATUSES = [
  PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
  PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
  PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
] as const;

type AdminPaymentTableProps = {
  items: BillingAdminPaymentRow[];
  tableAriaLabel: string;
  columns: {
    order: string;
    customer: string;
    amount: string;
    credits: string;
    gateway: string;
    webhook: string;
    status: string;
    action: string;
  };
  unknownOrderLabel: string;
  unknownAccountLabel: string;
  sepayNameLabel: string;
  viewActionLabel: string;
  reviewActionLabel: string;
  formatVnd: (amount: string | undefined) => string;
  getWebhookStatusLabel: (item: BillingAdminPaymentRow) => string;
  getOrderStatusLabel: (item: BillingAdminPaymentRow) => string;
  onSelectPayment: (item: BillingAdminPaymentRow) => void;
};

/**
 * Business purpose: Render the admin billing payment table with fixed column proportions and per-row investigation actions.
 * Business rules:
 * - Preserves the 8-column header contract (Order, Customer account, Amount, Credits, Gateway, Webhook, Status, Action).
 * - Highlights payments requiring reconciliation review with the localized Review action label.
 * Execution flow:
 * 1. Render colgroup and table header row.
 * 2. Map each BillingAdminPaymentRow into AdminPaymentRow with formatted VND amounts and status labels.
 * Failure cases:
 * - Empty or loading states are handled by the parent container before rendering this table.
 * Side effects:
 * - Delegates row selection to onSelectPayment.
 */
export function AdminPaymentTable({
  items,
  tableAriaLabel,
  columns,
  unknownOrderLabel,
  unknownAccountLabel,
  sepayNameLabel,
  viewActionLabel,
  reviewActionLabel,
  formatVnd,
  getWebhookStatusLabel,
  getOrderStatusLabel,
  onSelectPayment,
}: AdminPaymentTableProps) {
  return (
    <TooltipProvider>
      <div
        className="overflow-x-auto px-3 pt-2"
        data-component="AdminPaymentTable"
      >
        <table
          aria-label={tableAriaLabel}
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
              <th className="px-2 py-3 font-medium">{columns.order}</th>
              <th className="px-2 py-3 font-medium">{columns.customer}</th>
              {/* Monetary columns use right-aligned tabular numerals to prevent overlap with adjacent text */}
              <th className="px-2 py-3 text-right font-medium">{columns.amount}</th>
              <th className="px-2 py-3 text-right font-medium">{columns.credits}</th>
              <th className="px-2 py-3 font-medium">{columns.gateway}</th>
              <th className="px-2 py-3 font-medium">{columns.webhook}</th>
              <th className="px-2 py-3 font-medium">{columns.status}</th>
              <th className="px-2 py-3 font-medium">{columns.action}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => {
              const needsReview = NEEDS_REVIEW_STATUSES.includes(
                item.reconciliationStatus as (typeof NEEDS_REVIEW_STATUSES)[number],
              );
              return (
                <AdminPaymentRow
                  key={item.id}
                  item={item}
                  orderLabel={item.order?.paymentCode ?? unknownOrderLabel}
                  customerLabel={item.account?.email ?? unknownAccountLabel}
                  amountLabel={formatVnd(item.amountVnd)}
                  creditsLabel={
                    item.order?.creditUnits
                      ? formatVnd(item.order.creditUnits)
                      : "\u2014"
                  }
                  gatewayLabel={
                    item.provider === BILLING_ADMIN_GATEWAYS.sepay
                      ? sepayNameLabel
                      : item.provider
                  }
                  webhookLabel={getWebhookStatusLabel(item)}
                  orderStatusLabel={getOrderStatusLabel(item)}
                  actionLabel={needsReview ? reviewActionLabel : viewActionLabel}
                  onSelect={onSelectPayment}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
