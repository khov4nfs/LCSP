import { z } from "zod";
import { LEGAL_SOURCE_DELETION_REASON_CODES } from "@lcsp/contracts/legal-source";

export const legalSourceDeletionFormSchema = z.strictObject({
  confirmationSlug: z.string().trim().min(1),
  reasonCode: z.enum(LEGAL_SOURCE_DELETION_REASON_CODES),
  reasonText: z.string().trim().min(1).max(1000),
});

export type LegalSourceDeletionFormValues = z.infer<
  typeof legalSourceDeletionFormSchema
>;
