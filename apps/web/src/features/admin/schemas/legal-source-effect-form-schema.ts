import { z } from "zod";
import {
  LEGAL_SOURCE_CHUNK_STATUSES,
  legalSourceProvisionStatusesSchema,
  type LegalSourceChunkStatus,
} from "@lcsp/contracts/legal-source";

const statuses = Object.values(LEGAL_SOURCE_CHUNK_STATUSES) as [
  LegalSourceChunkStatus,
  ...LegalSourceChunkStatus[],
];

export const legalSourceEffectFormSchema = z
  .object({
    status: z.enum(statuses),
    sourceRef: z.string().trim().max(500),
    effectiveDate: z.string(),
    provisionStatuses: z.string(),
  })
  .superRefine((input, context) => {
    if (
      input.status !== LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN &&
      !input.sourceRef
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceRef"],
        message: "pages.legalSources.validation.effectSourceRefRequired",
      });
    }
    if (
      input.effectiveDate &&
      !z.iso.date().safeParse(input.effectiveDate).success
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveDate"],
        message: "pages.legalSources.validation.effectiveDateInvalid",
      });
    }
    let parsed: unknown;
    try {
      parsed = input.provisionStatuses.trim()
        ? JSON.parse(input.provisionStatuses)
        : {};
    } catch {
      parsed = null;
    }
    if (!legalSourceProvisionStatusesSchema.safeParse(parsed).success) {
      context.addIssue({
        code: "custom",
        path: ["provisionStatuses"],
        message: "pages.legalSources.validation.provisionStatusesInvalid",
      });
    }
  })
  .transform((input) => ({
    status: input.status,
    sourceRef: input.sourceRef || undefined,
    effectiveDate: input.effectiveDate || null,
    provisionStatuses: legalSourceProvisionStatusesSchema.parse(
      input.provisionStatuses.trim() ? JSON.parse(input.provisionStatuses) : {},
    ),
  }));

export type LegalSourceEffectFormInput = z.input<
  typeof legalSourceEffectFormSchema
>;
