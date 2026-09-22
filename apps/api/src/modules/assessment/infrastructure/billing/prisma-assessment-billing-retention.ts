import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { BILLING_RESERVATION_STATUSES } from "@lcsp/contracts/billing";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { BillingAccountingKernel } from "../../../billing/application/shared/billing-accounting.kernel.js";
import type { AssessmentBillingRetentionPort } from "../../application/ports/billing/assessment-billing-retention.port.js";

/**
 * Retains billing records across assessment deletion using the billing accounting kernel.
 */
@Injectable()
export class PrismaAssessmentBillingRetention implements AssessmentBillingRetentionPort {
  /**
   * Creates the retention adapter.
   *
   * @param prisma - Prisma service used to find reservations still holding credit.
   * @param accounting - Billing kernel that returns credit through the ledger rather than by direct write.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: BillingAccountingKernel,
  ) {}

  /**
   * Releases every reservation that still holds credit for the assessment.
   *
   * Release goes through the accounting kernel so the wallet projection and
   * ledger stay consistent; clearing the rows directly would strand the credit.
   *
   * @param input - Assessment being deleted and the owning user.
   * @returns Identifiers of the reservations that were released.
   */
  async releaseActiveReservations(input: {
    assessmentId: string;
    userId: string;
  }): Promise<string[]> {
    const active = await this.prisma.billingReservation.findMany({
      where: {
        assessmentId: input.assessmentId,
        status: BILLING_RESERVATION_STATUSES.RESERVED,
      },
      select: { id: true },
    });

    const released: string[] = [];
    for (const reservation of active) {
      await this.accounting.releaseReservation({
        userId: input.userId,
        reservationId: reservation.id,
        assessmentId: input.assessmentId,
      });
      released.push(reservation.id);
    }
    return released;
  }

  /**
   * Clears the assessment link on retained billing records.
   *
   * @param assessmentId - Assessment being deleted.
   * @param tx - Transaction that also deletes the assessment.
   */
  async detachAssessment(
    assessmentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.llmUsageEvent.updateMany({
      where: { assessmentId },
      data: { assessmentId: null },
    });
    await tx.billingReservation.updateMany({
      where: { assessmentId },
      data: { assessmentId: null },
    });
  }
}
