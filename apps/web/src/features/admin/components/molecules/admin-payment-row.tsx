import type { BillingAdminPaymentRow } from "@lcsp/contracts/billing";

import { Button } from "@/components/ui/button";

import { AdminPaymentStatusBadge } from "./admin-payment-status-badge";

type AdminPaymentRowProps = {
  item: BillingAdminPaymentRow;
  orderLabel: string;
  customerLabel: string;
  amountLabel: string;
  creditsLabel: string;
  gatewayLabel: string;
  webhookLabel: string;
  orderStatusLabel: string;
  actionLabel: string;
  onSelect: (item: BillingAdminPaymentRow) => void;
};

/**
 * Business purpose: Render one admin billing payment row aligned to Figma master 1682:1261 (LCSP Data / Table row / payment).
 * Business rules:
 * - Displays authoritative order reference, customer account, tabular VND amount/credits, gateway, webhook status, order status, and investigation action.
 * - Never exposes raw webhook secrets or unredacted provider payloads.
 * Execution flow:
 * 1. Render table cells with semantic status badges for webhook and order status.
 * 2. Invoke onSelect(item) when the operator clicks View or Review.
 * Failure cases:
 * - Missing order or account metadata renders localized fallback labels supplied by the parent.
 * Side effects:
 * - Triggers onSelect callback for opening PaymentInvestigationDialog.
 */
export function AdminPaymentRow({
  item,
  orderLabel,
  customerLabel,
  amountLabel,
  creditsLabel,
  gatewayLabel,
  webhookLabel,
  orderStatusLabel,
  actionLabel,
  onSelect,
}: AdminPaymentRowProps) {
  return (
    <tr data-component="AdminPaymentRow">
      <td className="whitespace-nowrap px-2 py-4">
        <div className="font-medium text-foreground">{orderLabel}</div>
      </td>
      <td className="whitespace-nowrap px-2 py-4 text-muted-foreground">
        {customerLabel}
      </td>
      <td className="whitespace-nowrap px-2 py-4 tabular-nums text-muted-foreground">
        {amountLabel}
      </td>
      <td className="whitespace-nowrap px-2 py-4 tabular-nums text-muted-foreground">
        {creditsLabel}
      </td>
      <td className="px-2 py-4 text-muted-foreground">{gatewayLabel}</td>
      <td className="px-2 py-4">
        <AdminPaymentStatusBadge
          mode="webhook"
          label={webhookLabel}
          reconciliationStatus={item.reconciliationStatus}
        />
      </td>
      <td className="px-2 py-4">
        <AdminPaymentStatusBadge
          mode="order"
          label={orderStatusLabel}
          reconciliationStatus={item.reconciliationStatus}
          orderStatus={item.order?.status}
        />
      </td>
      <td className="px-2 py-4">
        <Button
          className="h-auto px-0 text-muted-foreground hover:text-foreground"
          variant="link"
          size="sm"
          onClick={() => onSelect(item)}
        >
          {actionLabel}
        </Button>
      </td>
    </tr>
  );
}
