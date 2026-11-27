"use client";

import {
  BILLING_ORDER_STATUSES,
  type BillingOrderView,
} from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  useBillingEstimateQuery,
  useBillingHistoryQuery,
  useBillingOrderQuery,
  useBillingWalletQuery,
  useCreateBillingOrderMutation,
} from "@/lib/api/billing-queries";
import { apiQueryKeys } from "@/lib/api/query-keys";

import { getBillingOrderPresentation } from "../../utils/billing-order-presentation";
import {
  billingTopUpSchema,
  type BillingTopUpFormValues,
} from "../../schemas/billing-top-up.schema";
import { WalletBalanceCard } from "../molecules/wallet-balance-card";
import { PaymentOrderCard } from "./payment-order-card";
import { TopUpForm } from "./top-up-form";
import { TransactionHistory } from "./transaction-history";

/**
 * Business purpose: Orchestrate customer prepaid VND wallet balance, top-up order creation, active payment instructions, and transaction history.
 * Business rules:
 * - Preserves idempotency keys across failed retries for the same amountVnd and requires confirmation before creating a second pending order.
 * - Never simulates payment success; wallet balance and order status reflect only authoritative server query responses.
 * Execution flow:
 * 1. Fetch wallet balance, paginated order history, live top-up estimate, and active order status.
 * 2. Synchronize wallet and history caches whenever a pending order transitions to a terminal status.
 * 3. Compose WalletBalanceCard, TopUpForm, EstimateSection, PaymentOrderCard, and TransactionHistory.
 * Failure cases:
 * - Loading and error states render localized feedback with an explicit retry trigger instead of partial or fabricated balances.
 * Side effects:
 * - Submits top-up order mutations, invalidates React Query billing keys on settlement, and copies payment codes to the clipboard.
 */
export function BillingSettingsPanel({ locale }: { locale: Locale }) {
  const walletQuery = useBillingWalletQuery();
  const refetchWallet = walletQuery.refetch;
  const [historyPage, setHistoryPage] = useState(1);
  const historyQuery = useBillingHistoryQuery(historyPage);
  const latestHistoryQuery = useBillingHistoryQuery(1);
  const createOrderMutation = useCreateBillingOrderMutation();
  const queryClient = useQueryClient();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [copiedPaymentCode, setCopiedPaymentCode] = useState(false);
  const [additionalOrderConfirmation, setAdditionalOrderConfirmation] =
    useState<BillingTopUpFormValues | null>(null);
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);
  const [orderIntent, setOrderIntent] = useState<{
    amountVnd: string;
    idempotencyKey: string;
  } | null>(null);
  const form = useForm<BillingTopUpFormValues>({
    resolver: zodResolver(billingTopUpSchema),
    defaultValues: { amountVnd: "" },
  });
  const amountVnd = useWatch({
    control: form.control,
    name: "amountVnd",
  });
  const validAmountVnd = useMemo(
    () =>
      billingTopUpSchema.safeParse({ amountVnd }).success ? amountVnd : "",
    [amountVnd],
  );
  const estimateQuery = useBillingEstimateQuery(validAmountVnd);
  const visibleHistoryOrders = useMemo(
    () =>
      Array.from(
        new Map(
          [
            ...(latestHistoryQuery.data?.orders ?? []),
            ...(historyQuery.data?.orders ?? []),
          ].map((order) => [order.id, order] as const),
        ).values(),
      ),
    [historyQuery.data?.orders, latestHistoryQuery.data?.orders],
  );
  const pendingOrders = useMemo(
    () =>
      visibleHistoryOrders.filter(
        (order) =>
          order.status === BILLING_ORDER_STATUSES.PENDING_PAYMENT ||
          order.status === BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
      ),
    [visibleHistoryOrders],
  );
  const pendingHistoryOrder = pendingOrders[0];
  const activeOrderId = selectedOrderId ?? pendingHistoryOrder?.id ?? null;
  const orderQuery = useBillingOrderQuery(activeOrderId);
  const historyOrder = selectedOrderId
    ? visibleHistoryOrders.find((order) => order.id === selectedOrderId)
    : pendingHistoryOrder;
  const displayedOrder = orderQuery.isError
    ? historyOrder
    : (orderQuery.data ?? historyOrder);
  const lastSettledOrder = useRef<string | null>(null);
  const observedHistoryStatuses = useRef(
    new Map<BillingOrderView["id"], BillingOrderView["status"]>(),
  );
  const initialHistoryWalletSync = useRef(false);

  useEffect(() => {
    if (
      !latestHistoryQuery.isSuccess ||
      latestHistoryQuery.isFetching ||
      !walletQuery.isSuccess ||
      walletQuery.isFetching ||
      initialHistoryWalletSync.current
    )
      return;
    initialHistoryWalletSync.current = true;
    void refetchWallet();
  }, [
    latestHistoryQuery.isFetching,
    latestHistoryQuery.isSuccess,
    refetchWallet,
    walletQuery.isFetching,
    walletQuery.isSuccess,
  ]);

  useEffect(() => {
    const orders = [
      ...(latestHistoryQuery.data?.orders ?? []),
      ...(historyQuery.data?.orders ?? []),
    ];
    let anyOrderSettled = false;
    for (const order of orders) {
      const previousStatus = observedHistoryStatuses.current.get(order.id);
      if (
        previousStatus &&
        !getBillingOrderPresentation(previousStatus).isTerminal &&
        getBillingOrderPresentation(order.status).isTerminal
      ) {
        anyOrderSettled = true;
      }
      observedHistoryStatuses.current.set(order.id, order.status);
    }
    if (anyOrderSettled) {
      void queryClient.invalidateQueries({
        queryKey: apiQueryKeys.billing.wallet(),
      });
    }
  }, [historyQuery.data, latestHistoryQuery.data, queryClient]);

  useEffect(() => {
    const order = orderQuery.data;
    if (!order) return;
    const settlementKey = `${order.id}:${order.status}`;
    if (
      !getBillingOrderPresentation(order.status).isTerminal ||
      lastSettledOrder.current === settlementKey
    )
      return;
    lastSettledOrder.current = settlementKey;
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: apiQueryKeys.billing.wallet(),
      }),
      queryClient.invalidateQueries({ queryKey: ["billing", "history"] }),
    ]);
  }, [
    orderQuery.data,
    orderQuery.data?.id,
    orderQuery.data?.status,
    queryClient,
  ]);

  useEffect(() => {
    if (selectedOrderId && displayedOrder?.id === selectedOrderId) {
      paymentSectionRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [displayedOrder?.id, selectedOrderId]);

  async function handleSubmit(values: BillingTopUpFormValues) {
    if (pendingOrders.length > 0) {
      setAdditionalOrderConfirmation(values);
      return;
    }
    await createOrder(values);
  }

  async function createOrder(values: BillingTopUpFormValues) {
    const attempt =
      orderIntent?.amountVnd === values.amountVnd
        ? orderIntent
        : {
            amountVnd: values.amountVnd,
            idempotencyKey: crypto.randomUUID(),
          };
    if (attempt !== orderIntent) setOrderIntent(attempt);
    try {
      const order = await createOrderMutation.mutateAsync({
        amountVnd: values.amountVnd,
        idempotencyKey: attempt.idempotencyKey,
      });
      setOrderIntent(null);
      setSelectedOrderId(order.id);
      setCopiedPaymentCode(false);
      setAdditionalOrderConfirmation(null);
      form.reset();
    } catch {
      // Keep the idempotency key so a retry replays the same server operation.
    }
  }

  async function confirmAdditionalOrder() {
    if (!additionalOrderConfirmation) return;
    const values = additionalOrderConfirmation;
    setAdditionalOrderConfirmation(null);
    await createOrder(values);
  }

  function openOrder(orderId: string) {
    setAdditionalOrderConfirmation(null);
    setSelectedOrderId(orderId);
    setCopiedPaymentCode(false);
  }

  async function copyPaymentCode(paymentCode: string) {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(paymentCode);
    setCopiedPaymentCode(true);
  }

  function refreshOrderStatus() {
    void Promise.all([
      orderQuery.refetch(),
      walletQuery.refetch(),
      historyQuery.refetch(),
      latestHistoryQuery.refetch(),
    ]);
  }

  const hasLoadError =
    walletQuery.isError || historyQuery.isError || latestHistoryQuery.isError;
  if (
    walletQuery.isLoading ||
    historyQuery.isLoading ||
    latestHistoryQuery.isLoading
  ) {
    return (
      <PanelShell locale={locale}>
        <p role="status" className="text-sm text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.loading",
          )}
        </p>
      </PanelShell>
    );
  }

  if (hasLoadError || !walletQuery.data || !historyQuery.data) {
    return (
      <PanelShell locale={locale}>
        <Alert variant="destructive">
          <AlertTitle>
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.errorTitle",
            )}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.errorDescription",
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void walletQuery.refetch();
                void historyQuery.refetch();
                void latestHistoryQuery.refetch();
              }}
            >
              <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.retry",
              )}
            </Button>
          </AlertDescription>
        </Alert>
      </PanelShell>
    );
  }

  return (
    <PanelShell locale={locale}>
      <header>
        <h2 className="text-lg font-medium">
          {resolveMessage(locale, "pages.workspace.settingsHub.billing.title")}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.description",
          )}
        </p>
      </header>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <WalletBalanceCard
          locale={locale}
          formattedAvailableBalance={formatVnd(
            walletQuery.data.availableCredits,
            locale,
          )}
          formattedReservedBalance={formatVnd(
            walletQuery.data.reservedCredits,
            locale,
          )}
        />

        <TopUpForm
          locale={locale}
          form={form}
          isSubmitting={createOrderMutation.isPending}
          isSubmitError={createOrderMutation.isError}
          hasPendingOrders={pendingOrders.length > 0}
          hasPendingHistoryOrder={Boolean(pendingHistoryOrder)}
          showAdditionalConfirmation={additionalOrderConfirmation !== null}
          onSubmit={handleSubmit}
          onOpenExistingOrder={() => {
            if (pendingHistoryOrder) openOrder(pendingHistoryOrder.id);
          }}
          onConfirmAdditionalOrder={() => void confirmAdditionalOrder()}
          onCancelAdditionalOrder={() => setAdditionalOrderConfirmation(null)}
        />
      </div>

      <EstimateSection locale={locale} query={estimateQuery} />

      <div ref={paymentSectionRef}>
        {displayedOrder ? (
          <PaymentOrderCard
            locale={locale}
            order={displayedOrder}
            copied={copiedPaymentCode}
            isRefreshing={orderQuery.isFetching || walletQuery.isFetching}
            formattedAmount={formatVnd(displayedOrder.amountVnd, locale)}
            formattedCredits={formatCredits(displayedOrder.creditUnits, locale)}
            formattedExpiresAt={
              displayedOrder.expiresAt
                ? formatDate(displayedOrder.expiresAt, locale)
                : resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.unavailable",
                  )
            }
            formattedCreatedAt={formatDate(displayedOrder.createdAt, locale)}
            onCopy={() => void copyPaymentCode(displayedOrder.paymentCode)}
            onRefreshStatus={refreshOrderStatus}
          />
        ) : (
          <section className="mt-4 rounded-xl border border-dashed border-border/70 p-5">
            <h3 className="text-sm font-medium">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.activeOrderTitle",
              )}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.noActiveOrder",
              )}
            </p>
          </section>
        )}
      </div>

      <TransactionHistory
        locale={locale}
        orders={historyQuery.data.orders}
        page={historyQuery.data.page}
        pageSize={historyQuery.data.pageSize}
        totalCount={historyQuery.data.totalCount}
        isFetching={historyQuery.isFetching}
        previousLabel={resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.previousPage",
        )}
        nextLabel={resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.nextPage",
        )}
        formatAmount={(value) => formatVnd(value, locale)}
        formatDate={(value) => formatDate(value, locale)}
        onPageChange={setHistoryPage}
        onOpenOrder={openOrder}
      />
    </PanelShell>
  );
}

function PanelShell({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  return (
    <section
      aria-label={resolveMessage(
        locale,
        "pages.workspace.settingsHub.billing.title",
      )}
      className="h-full min-h-0 overflow-y-auto px-6 py-8 text-foreground md:px-8.5 md:py-10"
      data-component="BillingSettingsPanel"
    >
      {children}
    </section>
  );
}

function EstimateSection({
  locale,
  query,
}: {
  locale: Locale;
  query: ReturnType<typeof useBillingEstimateQuery>;
}) {
  return (
    <section
      aria-labelledby="billing-estimate-heading"
      className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-5"
    >
      <h3 id="billing-estimate-heading" className="text-sm font-medium">
        {resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.estimateTitle",
        )}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {resolveMessage(
          locale,
          "pages.workspace.settingsHub.billing.estimateDescription",
        )}
      </p>
      {!query.data && !query.isFetching ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.estimatePrompt",
          )}
        </p>
      ) : null}
      {query.isFetching ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.estimateLoading",
          )}
        </p>
      ) : null}
      {query.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.estimateError",
          )}
        </p>
      ) : null}
      {query.data ? (
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.estimateAmount",
            )}
            value={formatVnd(query.data.amountVnd, locale)}
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.estimateCredits",
            )}
            value={formatVnd(query.data.creditUnits, locale)}
          />
        </div>
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

function formatVnd(value: string, locale: Locale) {
  try {
    return `${new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US").format(BigInt(value))} VND`;
  } catch {
    return `${value} VND`;
  }
}

function formatCredits(value: string, locale: Locale) {
  try {
    return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US").format(
      BigInt(value),
    );
  } catch {
    return value;
  }
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
