import {
  LEGAL_SOURCE_LIMITS,
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  legalSourceProvisionStatusesSchema,
  type LegalSourceStructureProfile,
} from "@lcsp/contracts/legal-source";
import { z } from "zod";

const messages = {
  nameRequired: "pages.legalSources.validation.nameRequired",
  nameTooLong: "pages.legalSources.validation.nameTooLong",
  slugInvalid: "pages.legalSources.validation.slugInvalid",
  slugTooLong: "pages.legalSources.validation.slugTooLong",
  descriptionTooLong: "pages.legalSources.validation.descriptionTooLong",
  titleTooLong: "pages.legalSources.validation.titleTooLong",
  urlRequired: "pages.legalSources.validation.urlRequired",
  urlTooLong: "pages.legalSources.validation.urlTooLong",
  effectStatusTooLong: "pages.legalSources.validation.effectStatusTooLong",
  effectiveDateInvalid: "pages.legalSources.validation.effectiveDateInvalid",
  provisionStatusesInvalid:
    "pages.legalSources.validation.provisionStatusesInvalid",
  fileRequired: "pages.legalSources.validation.fileRequired",
  requestInvalid: "pages.legalSources.errors.requestInvalid",
} as const;

const nameSchema = z
  .string()
  .trim()
  .min(1, messages.nameRequired)
  .max(LEGAL_SOURCE_LIMITS.maxNameLength, messages.nameTooLong);
const descriptionSchema = z
  .string()
  .trim()
  .max(LEGAL_SOURCE_LIMITS.maxDescriptionLength, messages.descriptionTooLong)
  .transform((value) => (value === "" ? undefined : value))
  .optional();
const titleSchema = z
  .string()
  .trim()
  .max(LEGAL_SOURCE_LIMITS.maxTitleLength, messages.titleTooLong)
  .transform((value) => (value === "" ? undefined : value))
  .optional();
const effectStatusSchema = z
  .string()
  .trim()
  .max(LEGAL_SOURCE_LIMITS.maxEffectStatusLength, messages.effectStatusTooLong)
  .transform((value) => (value === "" ? undefined : value))
  .optional();
const effectiveDateSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.iso.date(messages.effectiveDateInvalid).optional(),
);
const structureProfileSchema = z.enum(
  Object.values(LEGAL_SOURCE_STRUCTURE_PROFILES) as [
    LegalSourceStructureProfile,
    ...LegalSourceStructureProfile[],
  ],
);
const provisionStatusesFieldSchema = z.string().transform((value, context) => {
  if (!value.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    context.addIssue({
      code: "custom",
      message: messages.provisionStatusesInvalid,
    });
    return undefined;
  }
  const result = legalSourceProvisionStatusesSchema.safeParse(parsed);
  if (!result.success) {
    context.addIssue({
      code: "custom",
      message: messages.provisionStatusesInvalid,
    });
    return undefined;
  }
  return result.data;
});

export const createLegalSourceFormSchema = z.object({
  name: nameSchema,
  slug: z
    .string()
    .trim()
    .max(64, messages.slugTooLong)
    .refine(
      (value) =>
        value === "" ||
        (value.length >= 3 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)),
      messages.slugInvalid,
    )
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  description: descriptionSchema,
});

export const updateLegalSourceFormSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
});

export const startLegalSourceVersionFormSchema = z.object({
  basedOnVersionId: z
    .string()
    .refine(
      (value) => value === "" || z.uuid().safeParse(value).success,
      messages.requestInvalid,
    )
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
});

export const uploadLegalSourceDocumentFormSchema = z
  .object({
    file: z.custom<File>(
      (value) => typeof File !== "undefined" && value instanceof File,
      messages.fileRequired,
    ),
    title: titleSchema,
    structureProfile: structureProfileSchema,
    sourceEffectStatus: effectStatusSchema,
    effectiveDate: effectiveDateSchema,
    provisionStatusesJson: provisionStatusesFieldSchema,
  })
  .transform(({ provisionStatusesJson, ...metadata }) => ({
    ...metadata,
    provisionStatuses: provisionStatusesJson,
  }));

export const importLegalSourceDocumentFormSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, messages.urlRequired)
      .max(LEGAL_SOURCE_LIMITS.maxUrlLength, messages.urlTooLong),
    title: titleSchema,
    structureProfile: structureProfileSchema,
    sourceEffectStatus: effectStatusSchema,
    effectiveDate: effectiveDateSchema,
    provisionStatusesJson: provisionStatusesFieldSchema,
  })
  .transform(({ provisionStatusesJson, ...metadata }) => ({
    ...metadata,
    provisionStatuses: provisionStatusesJson,
  }));
