import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import type { BillingPrepaidEstimate } from "@lcsp/contracts/billing";
import { estimatePrepaid } from "../../../domain/prepaid-estimate.js";
import { EstimateBillingQuery } from "./estimate-billing.query.js";

/** Top-up quote only (VND -> credits); model cost is never estimated. */
@QueryHandler(EstimateBillingQuery)
export class EstimateBillingHandler implements IQueryHandler<EstimateBillingQuery> {
  execute(query: EstimateBillingQuery): Promise<BillingPrepaidEstimate> {
    return Promise.resolve(estimatePrepaid(query.amountVnd));
  }
}
