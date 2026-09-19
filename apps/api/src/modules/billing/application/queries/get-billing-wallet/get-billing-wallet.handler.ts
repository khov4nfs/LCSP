import { Inject } from "@nestjs/common";
import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import type { BillingWalletView } from "@lcsp/contracts/billing";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import { GetBillingWalletQuery } from "./get-billing-wallet.query.js";

@QueryHandler(GetBillingWalletQuery)
export class GetBillingWalletHandler implements IQueryHandler<GetBillingWalletQuery> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
  ) {}

  execute(query: GetBillingWalletQuery) {
    return this.transactions.runForUser(query.userId, async (r) => {
      const wallet = await r.wallet.getOrCreateForUser(query.userId);
      return {
        walletId: wallet.id,
        availableCredits: wallet.availableCredits.toString(),
        reservedCredits: wallet.reservedCredits.toString(),
        totalCredits: (
          wallet.availableCredits + wallet.reservedCredits
        ).toString(),
        version: wallet.version,
      } satisfies BillingWalletView;
    });
  }
}
