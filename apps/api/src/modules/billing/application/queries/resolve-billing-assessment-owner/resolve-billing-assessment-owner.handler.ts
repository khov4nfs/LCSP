import { Inject } from "@nestjs/common";
import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import {
  BILLING_USAGE_KERNEL,
  type BillingUsagePort,
} from "../../shared/billing-usage.kernel.js";
import { ResolveBillingAssessmentOwnerQuery } from "./resolve-billing-assessment-owner.query.js";

@QueryHandler(ResolveBillingAssessmentOwnerQuery)
export class ResolveBillingAssessmentOwnerHandler implements IQueryHandler<ResolveBillingAssessmentOwnerQuery> {
  constructor(
    @Inject(BILLING_USAGE_KERNEL)
    private readonly billing: BillingUsagePort,
  ) {}

  execute(query: ResolveBillingAssessmentOwnerQuery) {
    return this.billing.resolveAssessmentOwner(query.assessmentId);
  }
}
