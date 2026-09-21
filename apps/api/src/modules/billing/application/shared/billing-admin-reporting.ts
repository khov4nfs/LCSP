import type { Prisma } from "@prisma/client";
import {
  BILLING_ADMIN_REPORTING,
  BILLING_DUPLICATE_REPORTING_SCOPES,
  BILLING_PENDING_RECONCILIATION_STATUSES,
  BILLING_USAGE_REVENUE_SOURCES,
  PAYMENT_RECONCILIATION_STATUSES,
  type BillingAdminRevenueSummary,
  type BillingAdminTransactionPage,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { InvalidBillingInputError } from "../../domain/billing.errors.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_PERIOD_DAYS = 30;

export type BillingAdminPeriodInput = {
  from?: string;
  to?: string;
};

export type BillingAdminTransactionInput = BillingAdminPeriodInput & {
  status?: string;
  provider?: string;
  userId?: string;
  email?: string;
  paymentCode?: string;
  orderId?: string;
  cursor?: string;
  pageSize?: number;
};

type Period = { from: Date; to: Date };

export function parseBillingAdminPeriod(
  input: BillingAdminPeriodInput,
): Period {
  const now = new Date();
  const to = input.to ? parseDate(input.to, "to") : now;
  const from = input.from
    ? parseDate(input.from, "from")
    : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS);

  if (from >= to) {
    throw new InvalidBillingInputError("BILLING_REPORTING_INVALID_INPUT");
  }
  if (
    to.getTime() - from.getTime() >
    BILLING_ADMIN_REPORTING.maxPeriodDays * DAY_MS
  ) {
    throw new InvalidBillingInputError("BILLING_REPORTING_INVALID_INPUT");
  }
  return { from, to };
}

export async function getRevenueSummary(
  prisma: PrismaService,
  input: BillingAdminPeriodInput,
): Promise<BillingAdminRevenueSummary> {
  const period = parseBillingAdminPeriod(input);
  const paymentWhere: Prisma.PaymentTransactionWhereInput = {
    reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.MATCHED,
    reconciledAt: { gte: period.from, lt: period.to },
  };
  const usageWhere: Prisma.CreditLedgerEntryWhereInput = {
    source: {
      in: [
        BILLING_USAGE_REVENUE_SOURCES.llmUsageDebit,
        BILLING_USAGE_REVENUE_SOURCES.reservationSettlement,
      ],
    },
    deltaCredits: { lt: 0n },
    createdAt: { gte: period.from, lt: period.to },
  };
  const pendingWhere: Prisma.PaymentTransactionWhereInput = {
    reconciliationStatus: { in: [...BILLING_PENDING_RECONCILIATION_STATUSES] },
    receivedAt: { gte: period.from, lt: period.to },
  };
  const duplicateWhere: Prisma.PaymentTransactionWhereInput = {
    reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.DUPLICATE,
    receivedAt: { gte: period.from, lt: period.to },
  };

  const [payments, usage, wallets, pendingCount, duplicateCount] =
    await Promise.all([
      prisma.paymentTransaction.aggregate({
        where: paymentWhere,
        _sum: { amountMinorUnits: true },
        _count: { _all: true },
      }),
      prisma.creditLedgerEntry.aggregate({
        where: usageWhere,
        _sum: { deltaCredits: true },
        _count: { _all: true },
      }),
      prisma.billingWallet.aggregate({
        _sum: { availableCredits: true, reservedCredits: true },
      }),
      prisma.paymentTransaction.count({ where: pendingWhere }),
      prisma.paymentTransaction.count({ where: duplicateWhere }),
    ]);

  const usageDebit = usage._sum.deltaCredits ?? 0n;
  const outstanding =
    (wallets._sum.availableCredits ?? 0n) +
    (wallets._sum.reservedCredits ?? 0n);

  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    currency: BILLING_ADMIN_REPORTING.currency,
    settledTopUps: {
      amountMinorUnits: (payments._sum.amountMinorUnits ?? 0n).toString(),
      count: payments._count._all,
    },
    usageRevenue: {
      amountMinorUnits: (-usageDebit).toString(),
      count: usage._count._all,
    },
    outstandingCredits: {
      credits: outstanding.toString(),
      asOf: new Date().toISOString(),
    },
    pendingReconciliation: { count: pendingCount },
    duplicateBlocked: {
      count: duplicateCount,
      scope: BILLING_DUPLICATE_REPORTING_SCOPES.durablePaymentTransactions,
    },
  };
}

export async function listAdminTransactions(
  prisma: PrismaService,
  input: BillingAdminTransactionInput,
): Promise<BillingAdminTransactionPage> {
  const period = parseBillingAdminPeriod(input);
  const pageSize = Math.min(
    normalizePositiveInteger(
      input.pageSize,
      BILLING_ADMIN_REPORTING.defaultPageSize,
    ),
    BILLING_ADMIN_REPORTING.maxPageSize,
  );
  const where: Prisma.PaymentTransactionWhereInput = {
    receivedAt: { gte: period.from, lt: period.to },
    ...(input.status
      ? { reconciliationStatus: parseBillingAdminStatus(input.status) }
      : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.email
      ? { user: { email: { contains: input.email, mode: "insensitive" } } }
      : {}),
    ...(input.paymentCode
      ? { billingOrder: { paymentCode: input.paymentCode } }
      : {}),
    ...(input.orderId ? { billingOrderId: input.orderId } : {}),
  };
  const queryWhere: Prisma.PaymentTransactionWhereInput = input.cursor
    ? { ...where, AND: [cursorWhere(input.cursor)] }
    : where;

  const cursorLimit = pageSize + 1;

  const [rows, total] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where: queryWhere,
      select: {
        id: true,
        provider: true,
        providerTransactionId: true,
        amountMinorUnits: true,
        reconciliationStatus: true,
        reconciliationReason: true,
        user: { select: { id: true, email: true } },
        billingOrder: {
          select: {
            id: true,
            paymentCode: true,
            status: true,
            amountMinorUnits: true,
            creditUnits: true,
          },
        },
        receivedAt: true,
        reconciledAt: true,
      },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: cursorLimit,
    }),
    prisma.paymentTransaction.count({ where }),
  ]);

  const hasNext = rows.length > pageSize;
  const pageRows = hasNext ? rows.slice(0, pageSize) : rows;
  const lastRow = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map((row) => ({
      paymentId: row.id,
      provider: row.provider,
      providerTransactionId: row.providerTransactionId,
      amountMinorUnits: row.amountMinorUnits.toString(),
      reconciliationStatus: row.reconciliationStatus,
      reconciliationReason: row.reconciliationReason,
      user: row.user,
      order: row.billingOrder
        ? {
            id: row.billingOrder.id,
            paymentCode: row.billingOrder.paymentCode,
            status: row.billingOrder.status,
            amountMinorUnits: row.billingOrder.amountMinorUnits.toString(),
            creditUnits: row.billingOrder.creditUnits.toString(),
          }
        : null,
      receivedAt: row.receivedAt.toISOString(),
      reconciledAt: row.reconciledAt?.toISOString() ?? null,
    })),
    pageSize,
    total,
    hasNext,
    nextCursor: lastRow
      ? encodeBillingTransactionCursor(lastRow.receivedAt, lastRow.id)
      : null,
  };
}

type BillingTransactionCursor = { receivedAt: string; id: string };

function encodeBillingTransactionCursor(receivedAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ receivedAt: receivedAt.toISOString(), id }),
    "utf8",
  ).toString("base64url");
}

function cursorWhere(value: string): Prisma.PaymentTransactionWhereInput {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new InvalidBillingInputError(
      "BILLING_REPORTING_INVALID_INPUT:cursor",
    );
  }
  if (
    !decoded ||
    typeof decoded !== "object" ||
    typeof (decoded as Partial<BillingTransactionCursor>).id !== "string" ||
    !(decoded as Partial<BillingTransactionCursor>).id
  ) {
    throw new InvalidBillingInputError(
      "BILLING_REPORTING_INVALID_INPUT:cursor",
    );
  }
  const receivedAt = parseDate(
    (decoded as Partial<BillingTransactionCursor>).receivedAt ?? "",
    "cursor",
  );
  const id = (decoded as BillingTransactionCursor).id;
  return {
    OR: [{ receivedAt: { lt: receivedAt } }, { receivedAt, id: { lt: id } }],
  };
}

function parseDate(value: string, field: string): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new InvalidBillingInputError(
      `BILLING_REPORTING_INVALID_INPUT:${field}`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidBillingInputError(
      `BILLING_REPORTING_INVALID_INPUT:${field}`,
    );
  }
  return parsed;
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

export function parseBillingAdminStatus(value: string) {
  if (
    !Object.values(PAYMENT_RECONCILIATION_STATUSES).includes(
      value as (typeof PAYMENT_RECONCILIATION_STATUSES)[keyof typeof PAYMENT_RECONCILIATION_STATUSES],
    )
  ) {
    throw new InvalidBillingInputError(
      "BILLING_REPORTING_INVALID_INPUT:status",
    );
  }
  return value as (typeof PAYMENT_RECONCILIATION_STATUSES)[keyof typeof PAYMENT_RECONCILIATION_STATUSES];
}
