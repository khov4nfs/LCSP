import type { BillingAdminPaymentRow } from "@lcsp/contracts/billing";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
 * - Displays authoritative order reference, customer account, right-aligned tabular VND amount/credits, gateway, webhook status, order status, and investigation action.
 * - Constrains long order references and customer emails with ellipsis truncation and accessible Tooltip disclosure so cells never bleed into adjacent columns.
 * - Never exposes raw webhook secrets or unredacted provider payloads.
 * Execution flow:
 * 1. Render constrained cells with Tooltip disclosures for order and customer account, plus semantic status badges.
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
      {/* Constrain order and customer cells inside table-fixed layout and expose full value via shadcn Tooltip */}
      <td className="overflow-hidden px-2 py-4">
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="block max-w-full truncate font-medium text-foreground outline-none focus-visible:underline"
              />
            }
          >
            {orderLabel}
          </TooltipTrigger>
          <TooltipContent>{orderLabel}</TooltipContent>
        </Tooltip>
      </td>
      <td className="overflow-hidden px-2 py-4 text-muted-foreground">
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="block max-w-full truncate outline-none focus-visible:underline"
              />
            }
          >
            {customerLabel}
          </TooltipTrigger>
          <TooltipContent>{customerLabel}</TooltipContent>
        </Tooltip>
      </td>
      <td className="whitespace-nowrap px-2 py-4 text-right tabular-nums text-muted-foreground">
        {amountLabel}
      </td>
      <td className="whitespace-nowrap px-2 py-4 text-right tabular-nums text-muted-foreground">
        {creditsLabel}
      </td>
      <td className="overflow-hidden px-2 py-4 text-muted-foreground">
        <span className="block max-w-full truncate">{gatewayLabel}</span>
      </td>
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
