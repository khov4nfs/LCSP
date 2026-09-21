import { z } from "zod";

import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ADMIN_PERIODS,
} from "./admin.ts";
import {
  BILLING_ESTIMATE_AVAILABILITY,
  BILLING_PAYMENT_PROVIDERS,
  PREPAID_BILLING_CONFIG,
} from "./prepaid.ts";
import { effectiveRuntimeModelSchema } from "./runtime-model.ts";
import {
  BILLING_ORDER_STATUSES,
  PAYMENT_RECONCILIATION_REASONS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "./statuses.ts";

const nonEmptyText = z.string().trim().min(1);
const flexibleText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1));
const nonNegativeIntegerText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(/^\d+$/));
const positiveIntegerText = nonNegativeIntegerText.refine(
  (value) => /[1-9]/.test(value),
);

const minimumAmountVnd = Number(PREPAID_BILLING_CONFIG.minimumAmountVnd);
const maximumAmountVnd = Number(PREPAID_BILLING_CONFIG.maximumAmountVnd);
const amountStepVnd = Number(PREPAID_BILLING_CONFIG.amountStepVnd);

/** Canonical validation for prepaid amounts accepted by Billing HTTP requests. */
export const billingAmountVndSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .refine((value) => {
    const normalized = value.replace(/^0+(?=\d)/, "");
    if (normalized.length > PREPAID_BILLING_CONFIG.maximumAmountVnd.length)
      return false;
    const amount = Number(normalized);
    return (
      Number.isSafeInteger(amount) &&
      amount >= minimumAmountVnd &&
      amount <= maximumAmountVnd &&
      amount % amountStepVnd === 0
    );
  });

export const billingWalletViewSchema = z.object({
  walletId: nonEmptyText,
  availableCredits: nonNegativeIntegerText,
  reservedCredits: nonNegativeIntegerText,
  totalCredits: nonNegativeIntegerText,
  version: z.number().int().safe().nonnegative(),
});
export type BillingWalletView = z.infer<typeof billingWalletViewSchema>;

export const billingUsageEstimateSchema = z.object({
  currency: z.literal(PREPAID_BILLING_CONFIG.currency),
  amountVnd: billingAmountVndSchema,
  creditUnits: nonNegativeIntegerText,
  expiresInHours: z.number().int().safe().positive(),
  availability: z.enum(BILLING_ESTIMATE_AVAILABILITY),
  effectiveRuntimeModel: effectiveRuntimeModelSchema.nullable(),
  estimatedUsageChargeVnd: nonNegativeIntegerText.nullable(),
});
export type BillingUsageEstimate = z.infer<typeof billingUsageEstimateSchema>;

export const billingPaymentInstructionsSchema = z.object({
  provider: z.enum(BILLING_PAYMENT_PROVIDERS),
  currency: z.literal(PREPAID_BILLING_CONFIG.currency),
  paymentCode: nonEmptyText,
  amountVnd: billingAmountVndSchema,
  bankName: z.string(),
  bankAccountNumber: z.string(),
  accountHolder: z.string(),
  transferContent: z.string(),
  qrCodeUrl: z.string(),
});

export const billingOrderViewSchema = z.object({
  id: nonEmptyText,
  amountVnd: billingAmountVndSchema,
  creditUnits: positiveIntegerText,
  paymentCode: nonEmptyText,
  status: z.enum(BILLING_ORDER_STATUSES),
  expiresAt: z.iso.datetime().nullable(),
  creditedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  paymentInstructions: billingPaymentInstructionsSchema,
});
export type BillingOrderView = z.infer<typeof billingOrderViewSchema>;

export const billingHistoryViewSchema = z.object({
  orders: z.array(billingOrderViewSchema),
  page: z.number().int().safe().positive(),
  pageSize: z.number().int().safe().positive(),
  totalCount: z.number().int().safe().nonnegative(),
});
export type BillingHistoryView = z.infer<typeof billingHistoryViewSchema>;

export const billingCreateOrderSchema = z.object({
  amount_vnd: billingAmountVndSchema,
});
export type BillingCreateOrderInput = z.infer<typeof billingCreateOrderSchema>;

export const billingIdempotencyKeySchema = nonEmptyText;

export const billingHistoryQuerySchema = z.object({
  page: z.preprocess(
    (value) =>
      value === undefined
        ? 1
        : typeof value === "string"
          ? Number(value)
          : value,
    z.number().int().safe().min(1),
  ),
  page_size: z.preprocess(
    (value) =>
      value === undefined
        ? 20
        : typeof value === "string"
          ? Number(value)
          : value,
    z
      .number()
      .int()
      .safe()
      .min(1)
      .transform((value) => Math.min(value, 100)),
  ),
});
export type BillingHistoryQueryInput = z.infer<
  typeof billingHistoryQuerySchema
>;

export const billingResourceIdSchema = nonEmptyText;

export const billingUsageReservationSchema = z
  .object({
    assessmentId: flexibleText,
    runId: flexibleText,
    idempotencyKey: flexibleText,
    provider: flexibleText,
    model: flexibleText,
    amountCredits: positiveIntegerText,
    maxChargeCredits: nonNegativeIntegerText,
    maxInputTokens: nonNegativeIntegerText,
    maxOutputTokens: nonNegativeIntegerText,
    maxReasoningTokens: nonNegativeIntegerText,
    maxInvocations: positiveIntegerText,
    authorizedModels: z
      .array(
        z.object({
          provider: flexibleText,
          model: flexibleText,
        }),
      )
      .min(1),
  })
  .superRefine((value, context) => {
    if (BigInt(value.amountCredits) < BigInt(value.maxChargeCredits)) {
      context.addIssue({
        code: "custom",
        path: ["amountCredits"],
        message: "Reservation amount must cover the maximum invocation charge",
      });
    }
  });
export type BillingUsageReservationRequest = z.infer<
  typeof billingUsageReservationSchema
>;

export const billingUsageReleaseSchema = z.object({
  assessmentId: flexibleText,
});
export type BillingUsageReleaseRequest = z.infer<
  typeof billingUsageReleaseSchema
>;

export const billingUsageClaimSchema = z.object({
  assessmentId: flexibleText,
  invocationId: flexibleText,
});
export type BillingUsageClaimRequest = z.infer<typeof billingUsageClaimSchema>;

export const billingUsageSettlementSchema = z
  .object({
    assessmentId: nonEmptyText,
    runId: nonEmptyText,
    agentRole: nonEmptyText,
    provider: nonEmptyText.optional(),
    model: nonEmptyText.optional(),
    effectiveRuntimeModel: effectiveRuntimeModelSchema.optional(),
    reservationId: flexibleText,
    invocationId: flexibleText,
    providerResponseId: flexibleText.optional(),
    inputTokens: nonNegativeIntegerText.optional(),
    cachedInputTokens: nonNegativeIntegerText.optional(),
    cacheWriteTokens: nonNegativeIntegerText.optional(),
    outputTokens: nonNegativeIntegerText.optional(),
    reasoningTokens: nonNegativeIntegerText.optional(),
    totalTokens: nonNegativeIntegerText.optional(),
    occurredAt: z.iso.datetime().optional(),
  })
  .superRefine((value, context) => {
    const provider = value.provider ?? value.effectiveRuntimeModel?.provider;
    const model = value.model ?? value.effectiveRuntimeModel?.model;
    if (!provider || !model) {
      context.addIssue({
        code: "custom",
        message: "Usage provider and model are required",
      });
      return;
    }
    if (
      (value.effectiveRuntimeModel?.provider &&
        value.effectiveRuntimeModel.provider !== provider) ||
      (value.effectiveRuntimeModel?.model &&
        value.effectiveRuntimeModel.model !== model)
    ) {
      context.addIssue({
        code: "custom",
        message: "Usage provider/model differs from effective runtime policy",
      });
    }
  });
export type BillingUsageSettlementRequest = z.infer<
  typeof billingUsageSettlementSchema
>;

const positiveQueryInteger = (fallback: number, maximum?: number) =>
  z.preprocess(
    (value) =>
      value === undefined
        ? fallback
        : typeof value === "string"
          ? Number(value)
          : value,
    z
      .number()
      .int()
      .safe()
      .min(1)
      .transform((value) =>
        maximum === undefined ? value : Math.min(value, maximum),
      ),
  );

const optionalPositiveQueryInteger = z.preprocess(
  (value) =>
    value === undefined
      ? undefined
      : typeof value === "string"
        ? Number(value)
        : value,
  z
    .number()
    .int()
    .safe()
    .min(1)
    .transform((value) => Math.min(value, 100))
    .optional(),
);

export const billingAdminDashboardQuerySchema = z.object({
  period: z.enum(BILLING_ADMIN_PERIODS).default(BILLING_ADMIN_PERIODS.d30),
  status: z
    .enum(BILLING_ADMIN_PAYMENT_FILTERS)
    .default(BILLING_ADMIN_PAYMENT_FILTERS.all),
  gateway: z.enum(BILLING_ADMIN_GATEWAYS).default(BILLING_ADMIN_GATEWAYS.all),
  page: positiveQueryInteger(1),
  pageSize: positiveQueryInteger(20, 100),
});
export type BillingAdminDashboardQuery = z.infer<
  typeof billingAdminDashboardQuerySchema
>;

export const billingAdminExportQuerySchema =
  billingAdminDashboardQuerySchema.pick({
    period: true,
    status: true,
    gateway: true,
  });
export type BillingAdminExportQuery = z.infer<
  typeof billingAdminExportQuerySchema
>;

const billingAdminAccountSchema = z.object({
  userId: nonEmptyText,
  email: z.email(),
  displayName: z.string().nullable(),
});

export const billingAdminPaymentRowSchema = z.object({
  id: nonEmptyText,
  provider: nonEmptyText,
  providerTransactionId: nonEmptyText,
  amountVnd: nonNegativeIntegerText,
  reconciliationStatus: z.enum(PAYMENT_RECONCILIATION_STATUSES),
  reconciliationReason: z.enum(PAYMENT_RECONCILIATION_REASONS).nullable(),
  receivedAt: z.iso.datetime(),
  reconciledAt: z.iso.datetime().nullable(),
  account: billingAdminAccountSchema.nullable(),
  order: z
    .object({
      id: nonEmptyText,
      paymentCode: nonEmptyText,
      status: z.enum(BILLING_ORDER_STATUSES),
      creditUnits: nonNegativeIntegerText.nullable(),
    })
    .nullable(),
});
export type BillingAdminPaymentRow = z.infer<
  typeof billingAdminPaymentRowSchema
>;

export const billingAdminSummarySchema = z.object({
  settledTopUpVnd: nonNegativeIntegerText,
  usageRevenueVnd: nonNegativeIntegerText,
  pendingReconciliationCount: z.number().int().safe().nonnegative(),
  duplicatePaymentCount: z.number().int().safe().nonnegative(),
  settledTopUpTrend: z
    .array(
      z.object({
        day: z.iso.date(),
        amountVnd: nonNegativeIntegerText,
      }),
    )
    .length(7),
});
export type BillingAdminSummary = z.infer<typeof billingAdminSummarySchema>;

export const billingAdminDashboardSchema = z.object({
  period: z.enum(BILLING_ADMIN_PERIODS),
  summary: billingAdminSummarySchema,
  items: z.array(billingAdminPaymentRowSchema),
  page: z.number().int().safe().positive(),
  pageSize: z.number().int().safe().positive(),
  totalCount: z.number().int().safe().nonnegative(),
});
export const billingAdminGatewaySchema = z.enum(BILLING_ADMIN_GATEWAYS);
export type BillingAdminDashboard = z.infer<typeof billingAdminDashboardSchema>;

export const billingAdminExportReportSchema = z.object({
  period: z.enum(BILLING_ADMIN_PERIODS),
  items: z.array(billingAdminPaymentRowSchema),
});
export type BillingAdminExportReport = z.infer<
  typeof billingAdminExportReportSchema
>;

export function parseBillingAdminDashboard(value: unknown) {
  const parsed = billingAdminDashboardSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const billingAdminReconciliationListQuerySchema = z.object({
  status: z.enum(PAYMENT_RECONCILIATION_STATUSES).optional(),
  page: positiveQueryInteger(1),
  take: positiveQueryInteger(50, 100),
  pageSize: optionalPositiveQueryInteger,
  page_size: optionalPositiveQueryInteger,
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  provider: nonEmptyText.optional(),
  userId: nonEmptyText.optional(),
  email: nonEmptyText.optional(),
  paymentCode: nonEmptyText.optional(),
  orderId: nonEmptyText.optional(),
});
export type BillingAdminReconciliationListQuery = z.infer<
  typeof billingAdminReconciliationListQuerySchema
>;

export const billingAdminResolveSchema = z.object({
  billingOrderId: nonEmptyText,
  expectedVersion: z.number().int().safe().min(0),
  rationale: nonEmptyText,
});
export type BillingAdminResolveRequest = z.infer<
  typeof billingAdminResolveSchema
>;

export const billingAdminRejectSchema = z.object({
  expectedStatus: z
    .enum(PAYMENT_RECONCILIATION_STATUSES)
    .default(PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW),
  expectedVersion: z.number().int().safe().min(0),
  rationale: nonEmptyText,
});
export type BillingAdminRejectRequest = z.infer<
  typeof billingAdminRejectSchema
>;

/** SePay JSON is parsed only after raw-body signature and timestamp verification. */
export const sePayWebhookPayloadSchema = z
  .object({
    id: z
      .union([z.string(), z.number()])
      .transform(String)
      .pipe(z.string().trim().min(1).max(128)),
    transferAmount: z
      .union([z.string(), z.number()])
      .transform(String)
      .pipe(z.string().regex(/^\d+$/)),
  })
  .passthrough();
export type SePayWebhookPayload = z.infer<typeof sePayWebhookPayloadSchema>;
