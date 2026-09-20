"use client";

import {
  BILLING_ESTIMATE_AVAILABILITY,
  BILLING_ORDER_STATUSES,
  type BillingOrderView,
} from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  CheckIcon,
  Clock3Icon,
  CopyIcon,
  QrCodeIcon,
  RefreshCwIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        <section
          aria-labelledby="billing-balance-heading"
          className="rounded-xl border border-border/70 bg-muted/20 p-5"
        >
          <div className="flex items-center gap-2">
            <WalletCardsIcon aria-hidden="true" className="size-4" />
            <h3 id="billing-balance-heading" className="text-sm font-medium">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.balanceTitle",
              )}
            </h3>
          </div>
          <p className="mt-4 text-2xl font-semibold tabular-nums">
            {formatVnd(walletQuery.data.availableCredits, locale)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.availableBalance",
            )}
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.reservedBalance",
            )}
            :{" "}
            <span className="font-medium text-foreground">
              {formatVnd(walletQuery.data.reservedCredits, locale)}
            </span>
          </p>
        </section>

        <section
          aria-labelledby="billing-top-up-heading"
          className="rounded-xl border border-border/70 bg-muted/20 p-5"
        >
          <h3 id="billing-top-up-heading" className="text-sm font-medium">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.topUpTitle",
            )}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.topUpDescription",
            )}
          </p>
          <form
            className="mt-4 space-y-3"
            onSubmit={form.handleSubmit(handleSubmit)}
            noValidate
          >
            <div className="space-y-2">
              <label htmlFor="billing-amount-vnd" className="text-sm">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.billing.amountLabel",
                )}
              </label>
              <Input
                id="billing-amount-vnd"
                inputMode="numeric"
                disabled={
                  createOrderMutation.isPending ||
                  additionalOrderConfirmation !== null
                }
                aria-invalid={
                  form.formState.errors.amountVnd ? "true" : undefined
                }
                placeholder={resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.billing.amountPlaceholder",
                )}
                {...form.register("amountVnd")}
              />
              {form.formState.errors.amountVnd ? (
                <p role="alert" className="text-xs text-destructive">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.amountInvalid",
                  )}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.billing.amountHint",
                )}
              </p>
            </div>
            <Button
              type="submit"
              disabled={
                createOrderMutation.isPending ||
                additionalOrderConfirmation !== null
              }
            >
              {createOrderMutation.isPending
                ? resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.creatingOrder",
                  )
                : resolveMessage(
                    locale,
                    pendingOrders.length > 0
                      ? "pages.workspace.settingsHub.billing.createAnotherOrder"
                      : "pages.workspace.settingsHub.billing.createOrder",
                  )}
            </Button>
            {createOrderMutation.isError ? (
              <p role="alert" className="text-xs text-destructive">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.billing.createOrderError",
                )}
              </p>
            ) : null}
            {additionalOrderConfirmation ? (
              <Alert>
                <AlertTitle>
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.confirmAdditionalOrderTitle",
                  )}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.confirmAdditionalOrderDescription",
                  )}
                </AlertDescription>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!pendingHistoryOrder}
                    onClick={() => {
                      if (pendingHistoryOrder)
                        openOrder(pendingHistoryOrder.id);
                    }}
                  >
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.billing.openExistingOrder",
                    )}
                  </Button>
                  <Button
                    type="button"
                    disabled={createOrderMutation.isPending}
                    onClick={() => void confirmAdditionalOrder()}
                  >
                    {createOrderMutation.isPending
                      ? resolveMessage(
                          locale,
                          "pages.workspace.settingsHub.billing.creatingOrder",
                        )
                      : resolveMessage(
                          locale,
                          "pages.workspace.settingsHub.billing.confirmCreateAnotherOrder",
                        )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setAdditionalOrderConfirmation(null)}
                  >
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.billing.cancelAdditionalOrder",
                    )}
                  </Button>
                </div>
              </Alert>
            ) : null}
          </form>
        </section>
      </div>

      <EstimateSection locale={locale} query={estimateQuery} />

      <div ref={paymentSectionRef}>
        {displayedOrder ? (
          <PaymentOrderSection
            locale={locale}
            order={displayedOrder}
            copied={copiedPaymentCode}
            onCopy={() => void copyPaymentCode(displayedOrder.paymentCode)}
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

      <HistorySection
        locale={locale}
        orders={historyQuery.data.orders}
        page={historyQuery.data.page}
        pageSize={historyQuery.data.pageSize}
        totalCount={historyQuery.data.totalCount}
        isFetching={historyQuery.isFetching}
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
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.effectiveProvider",
            )}
            value={
              query.data.effectiveRuntimeModel?.provider ??
              resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.unavailable",
              )
            }
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.effectiveModel",
            )}
            value={
              query.data.effectiveRuntimeModel?.model ??
              resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.unavailable",
              )
            }
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.estimatedUsageCharge",
            )}
            value={
              query.data.estimatedUsageChargeVnd
                ? formatVnd(query.data.estimatedUsageChargeVnd, locale)
                : resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.unavailable",
                  )
            }
          />
        </div>
      ) : null}
      {query.data?.availability ===
      BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration ? (
        <Alert className="mt-4">
          <AlertTitle>
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.insufficientPricingTitle",
            )}
          </AlertTitle>
          <AlertDescription>
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.insufficientPricingDescription",
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

function PaymentOrderSection({
  locale,
  order,
  copied,
  onCopy,
}: {
  locale: Locale;
  order: BillingOrderView;
  copied: boolean;
  onCopy: () => void;
}) {
  const presentation = getBillingOrderPresentation(order.status);
  return (
    <section
      aria-labelledby="billing-order-heading"
      className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-5"
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
        <Badge variant={presentation.badgeVariant}>
          {resolveMessage(locale, presentation.messageKey)}
        </Badge>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.orderAmount",
            )}
            value={formatVnd(order.amountVnd, locale)}
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.orderCredits",
            )}
            value={formatCredits(order.creditUnits, locale)}
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.expiresAt",
            )}
            value={
              order.expiresAt
                ? formatDate(order.expiresAt, locale)
                : resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.billing.unavailable",
                  )
            }
          />
          <Metric
            label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.createdAt",
            )}
            value={formatDate(order.createdAt, locale)}
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
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background p-3">
        <span className="text-xs text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.billing.paymentCode",
          )}
        </span>
        <code className="font-mono text-sm">{order.paymentCode}</code>
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
      </div>
      {presentation.showPendingPaymentHint ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3Icon aria-hidden="true" className="size-3.5" />
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

function HistorySection({
  locale,
  orders,
  page,
  pageSize,
  totalCount,
  isFetching,
  onPageChange,
  onOpenOrder,
}: {
  locale: Locale;
  orders: BillingOrderView[];
  page: number;
  pageSize: number;
  totalCount: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  return (
    <section aria-labelledby="billing-history-heading" className="mt-4">
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
        <div className="mt-3 overflow-x-auto rounded-xl border border-border/70">
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
                  <td className="px-4 py-3">
                    {formatDate(order.createdAt, locale)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatVnd(order.amountVnd, locale)}
                  </td>
                  <td className="px-4 py-3 font-mono">{order.paymentCode}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        getBillingOrderPresentation(order.status).badgeVariant
                      }
                    >
                      {resolveMessage(
                        locale,
                        getBillingOrderPresentation(order.status).messageKey,
                      )}
                    </Badge>
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
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.previousPage",
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isFetching}
            onClick={() => onPageChange(page + 1)}
          >
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.billing.nextPage",
            )}
          </Button>
        </nav>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="mt-1 block truncate font-medium">{value}</span>
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
