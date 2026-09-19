import { Injectable } from "@nestjs/common";
import {
  PaymentReconciliationReason,
  PaymentReconciliationStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  buildAuditEventInput,
} from "@lcsp/contracts/audit";
import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { selectEffectivePricingSnapshot } from "../../domain/effective-pricing.js";
import { resolveEffectiveRuntimeModel } from "../../domain/effective-runtime-model.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  BillingTransactionPort,
  BillingTransactionRepositories,
} from "../../domain/repositories/billing-transaction.port.js";

@Injectable()
export class PrismaBillingTransaction implements BillingTransactionPort {
  constructor(private readonly prisma: PrismaService) {}
  async runForUser<T>(
    userId: string,
    operation: (repositories: BillingTransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const repositories: BillingTransactionRepositories = {
        lockUserAccount: async (id) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        },
        wallet: {
          findForUser: (id) =>
            tx.billingWallet.findUnique({ where: { userId: id } }),
          getOrCreateForUser: async (id) => {
            const found = await tx.billingWallet.findUnique({
              where: { userId: id },
            });
            if (found) return found;
            try {
              return await tx.billingWallet.create({ data: { userId: id } });
            } catch (error) {
              if (this.code(error) === "P2002")
                return tx.billingWallet.findUniqueOrThrow({
                  where: { userId: id },
                });
              throw error;
            }
          },
          compareAndSetProjection: async (i) =>
            (
              await tx.billingWallet.updateMany({
                where: { id: i.walletId, version: i.expectedVersion },
                data: {
                  availableCredits: i.availableCredits,
                  reservedCredits: i.reservedCredits,
                  version: { increment: 1 },
                },
              })
            ).count === 1,
        },
        ledger: {
          findByIdempotencyKey: (key) =>
            tx.creditLedgerEntry.findUnique({ where: { idempotencyKey: key } }),
          append: async (i) => {
            try {
              return await tx.creditLedgerEntry.create({ data: i });
            } catch (error) {
              if (this.code(error) === "P2002")
                throw new Error("DUPLICATE_LEDGER_IDEMPOTENCY", {
                  cause: error,
                });
              throw error;
            }
          },
          listForWallet: (walletId) =>
            tx.creditLedgerEntry.findMany({
              where: { walletId },
              orderBy: { createdAt: "asc" },
            }),
        },
        reservation: {
          findForUser: (id, reservationId) =>
            tx.billingReservation.findFirst({
              where: { id: reservationId, userId: id },
            }),
          findByIdempotencyKey: (id, key) =>
            tx.billingReservation.findUnique({
              where: {
                userId_idempotencyKey: { userId: id, idempotencyKey: key },
              },
            }),
          createReserved: (i) =>
            tx.billingReservation.create({
              data: {
                ...i,
                remainingCredits: i.amountCredits,
                maxInvocations: i.maxInvocations ?? 1n,
              },
            }),
          claimInvocation: async (i) => {
            const existing =
              await tx.billingReservationInvocationClaim.findUnique({
                where: {
                  reservationId_invocationId: {
                    reservationId: i.reservationId,
                    invocationId: i.invocationId,
                  },
                },
              });
            if (existing) return true;
            await tx.billingReservationInvocationClaim.create({
              data: {
                reservationId: i.reservationId,
                invocationId: i.invocationId,
              },
            });
            const updated = await tx.$executeRaw(Prisma.sql`
                UPDATE "BillingReservation"
                SET "invocationsStarted" = "invocationsStarted" + 1
                WHERE "id" = ${i.reservationId}
                  AND "status" = 'RESERVED'
                  AND "invocationsStarted" < "maxInvocations"
              `);
            if (updated !== 1) {
              await tx.billingReservationInvocationClaim.delete({
                where: {
                  reservationId_invocationId: {
                    reservationId: i.reservationId,
                    invocationId: i.invocationId,
                  },
                },
              });
              return false;
            }
            return true;
          },
          listReservedForWallet: (walletId) =>
            tx.billingReservation.findMany({
              where: { walletId, status: "RESERVED" },
            }),
          consumeRemaining: async (i) =>
            (
              await tx.billingReservation.updateMany({
                where: {
                  id: i.reservationId,
                  status: "RESERVED",
                  remainingCredits: { gte: i.amountCredits },
                },
                data: { remainingCredits: { decrement: i.amountCredits } },
              })
            ).count === 1,
          transitionFromReserved: async (i) =>
            (
              await tx.billingReservation.updateMany({
                where: { id: i.reservationId, status: "RESERVED" },
                data: {
                  status: i.to,
                  remainingCredits: 0n,
                  ...(i.to === "SETTLED"
                    ? { settledAt: i.timestamp }
                    : { releasedAt: i.timestamp }),
                },
              })
            ).count === 1,
        },
        order: {
          findByPaymentCode: (paymentCode) =>
            tx.billingOrder.findUnique({ where: { paymentCode } }),
          findByPaymentCodes: (paymentCodes) =>
            tx.billingOrder.findMany({
              where: { paymentCode: { in: paymentCodes } },
            }),
          findById: (id) => tx.billingOrder.findUnique({ where: { id } }),
          findByIdempotencyKey: (userId, key) =>
            tx.billingOrder.findUnique({
              where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
            }),
          findForUser: (userId, id) =>
            tx.billingOrder.findFirst({ where: { id, userId } }),
          listForUser: async ({ userId, skip, take }) => {
            const [orders, totalCount] = await Promise.all([
              tx.billingOrder.findMany({
                where: { userId },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip,
                take,
              }),
              tx.billingOrder.count({ where: { userId } }),
            ]);
            return { orders, totalCount };
          },
          createPending: (i) => tx.billingOrder.create({ data: i }),
          transition: async (id, from, to) =>
            (
              await tx.billingOrder.updateMany({
                where: { id, status: from },
                data: {
                  status: to,
                  ...(to === "CREDITED" ? { creditedAt: new Date() } : {}),
                },
              })
            ).count === 1,
        },
        payment: {
          findById: (id) => tx.paymentTransaction.findUnique({ where: { id } }),
          findByProviderTransaction: (provider, id) =>
            tx.paymentTransaction.findUnique({
              where: {
                provider_providerTransactionId: {
                  provider,
                  providerTransactionId: id,
                },
              },
            }),
          create: (i) =>
            tx.paymentTransaction.create({
              data: i as Prisma.PaymentTransactionUncheckedCreateInput,
            }),
          setStatus: async (
            id,
            status,
            userId,
            billingOrderId,
            reason,
            expectedVersion,
          ) => {
            const updated = await tx.paymentTransaction.updateMany({
              where: {
                id,
                ...(expectedVersion === undefined
                  ? {}
                  : { reconciliationVersion: expectedVersion }),
              },
              data: {
                reconciliationStatus: status as PaymentReconciliationStatus,
                reconciliationReason:
                  reason === undefined
                    ? undefined
                    : reason
                      ? (reason as PaymentReconciliationReason)
                      : null,
                reconciliationVersion: { increment: 1 },
                userId,
                billingOrderId,
                reconciledAt: new Date(),
              },
            });
            if (updated.count !== 1)
              throw new Error("RECONCILIATION_VERSION_CONFLICT");
            return tx.paymentTransaction.findUniqueOrThrow({ where: { id } });
          },
        },
        webhook: {
          recordReceived: async (i) => {
            const found = await tx.sePayWebhookEvent.findUnique({
              where: {
                provider_providerTransactionId: {
                  provider: i.provider,
                  providerTransactionId: i.providerTransactionId,
                },
              },
            });
            if (found) return found;
            try {
              return await tx.sePayWebhookEvent.create({
                data: {
                  provider: i.provider,
                  providerTransactionId: i.providerTransactionId,
                  sanitizedPayload: i.sanitizedPayload as Prisma.InputJsonValue,
                },
                select: { id: true },
              });
            } catch (error) {
              if (this.code(error) === "P2002")
                return tx.sePayWebhookEvent.findUniqueOrThrow({
                  where: {
                    provider_providerTransactionId: {
                      provider: i.provider,
                      providerTransactionId: i.providerTransactionId,
                    },
                  },
                  select: { id: true },
                });
              throw error;
            }
          },
          findAcceptedById: async (id) => {
            const row = await tx.sePayWebhookEvent.findUnique({
              where: { id },
            });
            if (!row) return null;
            const payload = (row.sanitizedPayload ?? {}) as Record<
              string,
              unknown
            >;
            const amount = payload.amountMinorUnits;
            return {
              id: row.id,
              provider: row.provider,
              providerTransactionId: row.providerTransactionId,
              paymentCode:
                typeof payload.paymentCode === "string"
                  ? payload.paymentCode
                  : null,
              paymentCodes: Array.isArray(payload.paymentCodes)
                ? payload.paymentCodes.filter(
                    (value): value is string => typeof value === "string",
                  )
                : typeof payload.paymentCode === "string"
                  ? [payload.paymentCode]
                  : [],
              amountMinorUnits:
                typeof amount === "string" ? BigInt(amount) : 0n,
              transferDirection:
                payload.transferDirection === "IN" ||
                payload.transferDirection === "OUT"
                  ? payload.transferDirection
                  : "UNKNOWN",
              sanitizedPayload: row.sanitizedPayload,
              securityAcceptedAt: row.securityAcceptedAt,
              processedAt: row.processedAt,
            };
          },
          markProcessed: async (id, processedAt) =>
            (
              await tx.sePayWebhookEvent.updateMany({
                where: { id, processedAt: null },
                data: { processedAt },
              })
            ).count === 1,
        },
        usage: {
          findById: (id) => tx.llmUsageEvent.findUnique({ where: { id } }),
          findByInvocation: (userId, invocationId) =>
            tx.llmUsageEvent.findUnique({
              where: { userId_invocationId: { userId, invocationId } },
            }),
          findByProviderResponse: (provider, providerResponseId) =>
            tx.llmUsageEvent.findUnique({
              where: {
                provider_providerResponseId: { provider, providerResponseId },
              },
            }),
          create: async (i) => {
            const x = await tx.llmUsageEvent.create({ data: i });
            return x;
          },
          updateRetryable: async (i) =>
            tx.llmUsageEvent.update({
              where: { id: i.id },
              data: {
                providerResponseId: i.providerResponseId,
                inputTokens: i.inputTokens,
                cachedInputTokens: i.cachedInputTokens,
                cacheWriteTokens: i.cacheWriteTokens,
                outputTokens: i.outputTokens,
                reasoningTokens: i.reasoningTokens,
                totalTokens: i.totalTokens,
                pricingSnapshotId: i.pricingSnapshotId,
                runtimePolicySnapshotId: i.runtimePolicySnapshotId,
                providerCostCredits: i.providerCostCredits,
                customerChargeVnd: i.customerChargeVnd,
                chargedCredits: i.customerChargeVnd,
                status: "SETTLED",
                availabilityReason: null,
              },
            }),
        },
        pricing: {
          findById: async (id) => {
            const x = await tx.modelPricingSnapshot.findUnique({
              where: { id },
            });
            return (
              x && {
                ...x,
                inputPricePerMillion: x.inputPricePerMillion.toString(),
                cachedInputPricePerMillion:
                  x.cachedInputPricePerMillion?.toString(),
                cacheWritePricePerMillion:
                  x.cacheWritePricePerMillion?.toString(),
                outputPricePerMillion: x.outputPricePerMillion.toString(),
                reasoningPricePerMillion:
                  x.reasoningPricePerMillion?.toString(),
                providerCurrency: x.providerCurrency ?? undefined,
                customerCurrency: x.customerCurrency ?? undefined,
                markupBps: x.markupBps ?? undefined,
                fxRateVndNumerator: x.fxRateVndNumerator ?? undefined,
                fxRateVndDenominator: x.fxRateVndDenominator ?? undefined,
              }
            );
          },
          findApplicable: async (provider, model, occurredAt) => {
            const rows = await tx.modelPricingSnapshot.findMany({
              where: { provider, model, effectiveAt: { lte: occurredAt } },
              orderBy: { effectiveAt: "desc" },
            });
            const x = selectEffectivePricingSnapshot(rows, occurredAt);
            return (
              x && {
                ...x,
                inputPricePerMillion: x.inputPricePerMillion.toString(),
                cachedInputPricePerMillion:
                  x.cachedInputPricePerMillion?.toString(),
                cacheWritePricePerMillion:
                  x.cacheWritePricePerMillion?.toString(),
                outputPricePerMillion: x.outputPricePerMillion.toString(),
                reasoningPricePerMillion:
                  x.reasoningPricePerMillion?.toString(),
                providerCurrency: x.providerCurrency ?? undefined,
                customerCurrency: x.customerCurrency ?? undefined,
                markupBps: x.markupBps ?? undefined,
                fxRateVndNumerator: x.fxRateVndNumerator ?? undefined,
                fxRateVndDenominator: x.fxRateVndDenominator ?? undefined,
              }
            );
          },
        },
        runtimePolicy: {
          findApplicable: async (role, occurredAt) => {
            const rows = await tx.runtimeModelPolicySnapshot.findMany({
              where: { role, effectiveAt: { lte: occurredAt } },
              orderBy: { effectiveAt: "desc" },
            });
            const selected = resolveEffectiveRuntimeModel(
              rows,
              role,
              occurredAt,
            );
            return (
              rows.find(
                (row) =>
                  row.policyVersion === selected.policyVersion &&
                  row.effectiveAt.getTime() === selected.effectiveAt.getTime(),
              ) ?? null
            );
          },
        },
        audit: {
          append: async (i) => {
            const event = buildAuditEventInput({
              eventType: i.eventType,
              actorId: i.actorId,
              sessionId: i.sessionId,
              correlationId: i.correlationId,
              resourceType: AUDIT_RESOURCE_TYPES.httpRoute,
              resourceId: i.resourceId,
              decision: AUDIT_DECISIONS.allow,
              result: "RECORDED",
              redactionStatus: AUDIT_REDACTION_STATUSES.none,
              payload: i.payload,
            });
            await tx.auditEvent.create({
              data: {
                id: crypto.randomUUID(),
                eventType: event.eventType,
                actorId: event.actorId,
                sessionId: event.sessionId ?? null,
                correlationId: event.correlationId,
                resourceType: toPrismaAuditResourceType(
                  AUDIT_RESOURCE_TYPES.httpRoute,
                ),
                resourceId: event.resourceId,
                decision: event.decision
                  ? toPrismaAuthDecision(event.decision)
                  : null,
                payload: event.payload as Prisma.InputJsonValue,
              },
            });
          },
        },
        assessment: {
          findOwnerId: async (assessmentId) => {
            const assessment = await tx.assessment.findUnique({
              where: { id: assessmentId },
              select: { ownerId: true },
            });
            return assessment?.ownerId ?? null;
          },
        },
      };
      return operation(repositories);
    });
  }
  private code(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  }
}
