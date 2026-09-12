import { Injectable } from "@nestjs/common";
import { PaymentReconciliationStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
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
          createReserved: (i) => tx.billingReservation.create({ data: i }),
          listReservedForWallet: (walletId) =>
            tx.billingReservation.findMany({
              where: { walletId, status: "RESERVED" },
            }),
          transitionFromReserved: async (i) =>
            (
              await tx.billingReservation.updateMany({
                where: { id: i.reservationId, status: "RESERVED" },
                data: {
                  status: i.to,
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
          findByIdempotencyKey: (userId, key) =>
            tx.billingOrder.findUnique({
              where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
            }),
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
          setStatus: async (id, status, userId, billingOrderId) =>
            tx.paymentTransaction.update({
              where: { id },
              data: {
                reconciliationStatus: status as PaymentReconciliationStatus,
                userId,
                billingOrderId,
                reconciledAt: new Date(),
              },
            }),
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
        },
        usage: {
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
                outputPricePerMillion: x.outputPricePerMillion.toString(),
              }
            );
          },
          findApplicable: async (provider, model, occurredAt) => {
            const x = await tx.modelPricingSnapshot.findFirst({
              where: { provider, model, effectiveAt: { lte: occurredAt } },
              orderBy: [{ effectiveAt: "desc" }, { version: "desc" }],
            });
            return (
              x && {
                ...x,
                inputPricePerMillion: x.inputPricePerMillion.toString(),
                outputPricePerMillion: x.outputPricePerMillion.toString(),
              }
            );
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
