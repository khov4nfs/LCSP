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

  /**
   * Business purpose: Resolve the owner to whom an Assessment or Preparation usage receipt
   *   belongs.
   *
   * Business rules:
   * - Use Assessment ownership when an Assessment ID is supplied; otherwise use the validated
   *   Preparation run identity.
   * - System-requested Preparation can resolve to no customer owner; this lookup does not
   *   authorize a debit.
   *
   * Execution flow:
   * 1. Choose the applicable ownership lookup and return the billing kernel’s result.
   *
   * Failure cases:
   * - Missing workflows/requesters and repository failures propagate from the kernel; the
   *   request boundary must supply a valid workflow identity.
   *
   * Side effects:
   * - Delegated read-only ownership lookup; no usage or wallet records are written.
   */
  execute(query: ResolveBillingAssessmentOwnerQuery) {
    return query.assessmentId
      ? this.billing.resolveAssessmentOwner(query.assessmentId)
      : this.billing.resolvePreparationOwner(query.preparationRunId!);
  }
}
