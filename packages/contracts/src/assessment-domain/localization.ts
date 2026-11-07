import { z } from "zod";
import { LOCALES } from "../shared/locale.ts";

export const AUTHORED_LOCALIZATION_STATES = { PENDING: "PENDING", READY: "READY", FAILED: "FAILED" } as const;
export const AUTHORED_LOCALIZATION_CODES = { INCOMPLETE: "AUTHORED_LOCALIZATION_INCOMPLETE", PROVIDER_UNAVAILABLE: "TRANSLATION_PROVIDER_UNAVAILABLE", PROVIDER_INVALID: "TRANSLATION_PROVIDER_INVALID", TRANSLATION_FAILED: "TRANSLATION_FAILED" } as const;
export const AUTHORED_LOCALIZATION_ENTITIES = { LEGAL_REQUIREMENT: "LEGAL_REQUIREMENT", ASSESSMENT_RULE: "ASSESSMENT_RULE", DECISION: "DECISION", HUMAN_REQUEST: "HUMAN_REQUEST", EVENT: "EVENT", REPORT: "REPORT" } as const;
export const LOCALIZED_REPORT_SCHEMA_VERSION = "LCSP_LOCALIZED_REPORT_V1" as const;
export const localizedReportArtifactSchema = z.strictObject({
  schemaVersion: z.literal(LOCALIZED_REPORT_SCHEMA_VERSION), localizedArtifactId: z.uuid(),
  sourceArtifactId: z.uuid(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  locale: z.enum(LOCALES), translationRevision: z.number().int().positive(),
  localizedFields: z.record(z.string(), z.string()),
});
export type AuthoredLocalizationEntity = (typeof AUTHORED_LOCALIZATION_ENTITIES)[keyof typeof AUTHORED_LOCALIZATION_ENTITIES];
export const authoredLocalizationStatusSchema = z.strictObject({
  state: z.enum(AUTHORED_LOCALIZATION_STATES), locale: z.enum(LOCALES),
  canonicalDigest: z.string().regex(/^[a-f0-9]{64}$/), translationRevision: z.number().int().positive(),
});
export const authoredTranslationResponseSchema = z.strictObject({
  originSha256: z.string().regex(/^[a-f0-9]{64}$/), locale: z.enum(LOCALES),
  content: z.string().min(1), engine: z.string().min(1), engineVersion: z.string().min(1),
});
