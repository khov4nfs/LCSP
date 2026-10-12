import type { Prisma } from "@prisma/client";

export const ASSESSMENT_BILLING_RETENTION = Symbol(
  "ASSESSMENT_BILLING_RETENTION",
);

/**
 * Preserves billing history when the assessment it was recorded against is deleted.
 *
 * Reservations and usage events are financial records, so the database refuses
 * to destroy them with their assessment. Deleting an assessment therefore
 * returns any credit still held for it and clears the link, instead of either
 * failing or discarding the record.
 */
export type AssessmentBillingRetentionPort = {
  /**
   * Returns credits held by reservations that are still spendable for the assessment.
   *
   * @param input - Assessment being deleted and the user whose wallet holds the credit.
   * @returns Identifiers of the reservations that were released.
   */
  releaseActiveReservations(input: {
    assessmentId: string;
    userId: string;
  }): Promise<string[]>;

  /**
   * Clears the assessment link carried by retained billing records.
   *
   * @param assessmentId - Assessment being deleted.
   * @param tx - Transaction that also deletes the assessment.
   */
  detachAssessment(
    assessmentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
};
