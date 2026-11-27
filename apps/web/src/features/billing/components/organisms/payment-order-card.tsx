"use client";

import type { BillingOrderView } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";
import {
  CheckIcon,
  Clock3Icon,
  CopyIcon,
  QrCodeIcon,
  RefreshCwIcon,
} from "lucide-react";
import Image from "next/image";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { getBillingOrderPresentation } from "../../utils/billing-order-presentation";
import { PaymentStatusBadge } from "../molecules/payment-status-badge";

type PaymentOrderCardProps = {
  locale: Locale;
  order: BillingOrderView;
  copied: boolean;
  isRefreshing?: boolean;
  formattedAmount: string;
  formattedCredits: string;
  formattedExpiresAt: string;
  formattedCreatedAt: string;
  onCopy: () => void;
  onRefreshStatus?: () => void;
};

/**
 * Business purpose: Display the active payment order's transfer instructions, reference code, QR code, and authoritative status refresh control.
 * Business rules:
 * - Never simulates or marks an order as credited locally; status updates come strictly from server refresh/polling.
 * - Exposes copy-reference and manual status refresh controls while preserving bank transfer instructions.
 * Execution flow:
 * 1. Resolve order presentation flags via getBillingOrderPresentation(order.status).
 * 2. Render status badge, amount/credit metrics, QR code, bank transfer fields, copyable payment code, and refresh button.
 * Failure cases:
 * - Renders fallback icon when qrCodeUrl is absent and em-dash when bank fields are empty.
 * Side effects:
 * - Invokes parent clipboard copy and status refetch callbacks when triggered.
 */
export function PaymentOrderCard({
  locale,
  order,
  copied,
  isRefreshing = false,
  formattedAmount,
  formattedCredits,
  formattedExpiresAt,
  formattedCreatedAt,
  onCopy,
  onRefreshStatus,
}: PaymentOrderCardProps) {
  const presentation = getBillingOrderPresentation(order.status);

  return (
    <section
      aria-labelledby="billing-order-heading"
      className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-5"
      data-component="PaymentOrderCard"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="billing-order-heading" className="text-sm font-medium">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.paymentTitle",
            )}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.paymentDescription",
            )}
          </p>
        </div>
        <PaymentStatusBadge locale={locale} status={order.status} showDot />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.orderAmount",
            )}
            value={formattedAmount}
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.orderCredits",
            )}
            value={formattedCredits}
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.expiresAt",
            )}
            value={formattedExpiresAt}
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.createdAt",
            )}
            value={formattedCreatedAt}
          />
        </div>
        <div className="flex items-center justify-center rounded-lg border border-border/70 bg-background p-3">
          {order.paymentInstructions.qrCodeUrl ? (
            <Image
              src={order.paymentInstructions.qrCodeUrl}
              alt={resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.qrAlt",
              )}
              width={160}
              height={160}
              unoptimized
              className="size-40 rounded-md bg-white p-2"
            />
          ) : (
            <QrCodeIcon
              aria-hidden="true"
              className="size-16 text-muted-foreground"
            />
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Instruction
          label={resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.bankName",
          )}
          value={order.paymentInstructions.bankName}
        />
        <Instruction
          label={resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.accountNumber",
          )}
          value={order.paymentInstructions.bankAccountNumber}
        />
        <Instruction
          label={resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.accountHolder",
          )}
          value={order.paymentInstructions.accountHolder}
        />
        <Instruction
          label={resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.transferContent",
          )}
          value={order.paymentInstructions.transferContent}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.paymentCode",
            )}
          </span>
          <code className="font-mono text-sm font-semibold">
            {order.paymentCode}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCopy}>
            {copied ? (
              <CheckIcon aria-hidden="true" data-icon="inline-start" />
            ) : (
              <CopyIcon aria-hidden="true" data-icon="inline-start" />
            )}
            {resolveMessage(
              locale,
              copied
                ? "pages.workspace.settingsHub.billing.copied"
                : "pages.workspace.settingsHub.billing.copyPaymentCode",
            )}
          </Button>
          {onRefreshStatus ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isRefreshing}
              onClick={onRefreshStatus}
            >
              <RefreshCwIcon
                aria-hidden="true"
                data-icon="inline-start"
                className={isRefreshing ? "animate-spin" : undefined}
              />
              {resolveMessage(
                locale,
                isRefreshing
                  ? "pages.workspace.settingsHub.billing.checkingPaymentStatus"
                  : "pages.workspace.settingsHub.billing.checkPaymentStatus",
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {presentation.showPendingPaymentHint ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3Icon aria-hidden="true" className="size-3.5 shrink-0" />
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.pendingPaymentHint",
          )}
        </p>
      ) : null}

      {presentation.showPendingReconciliationAlert ? (
        <Alert className="mt-4">
          <AlertTitle>
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.pendingReconciliationTitle",
            )}
          </AlertTitle>
          <AlertDescription>
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.pendingReconciliationDescription",
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="mt-1 block truncate font-medium tabular-nums">
        {value}
      </span>
    </div>
  );
}

function Instruction({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-medium">{value || "—"}</p>
    </div>
  );
}
