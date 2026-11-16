import { z } from "zod";

export const FACT_NEED_SUBJECT_KINDS = {
  organization: "ORGANIZATION",
  deployment: "DEPLOYMENT",
  aiSystem: "AI_SYSTEM",
  useCase: "USE_CASE",
  model: "MODEL",
  dataset: "DATASET",
  control: "CONTROL",
  other: "OTHER",
} as const;

export const FACT_NEED_ENVIRONMENTS = {
  production: "PRODUCTION",
  staging: "STAGING",
  development: "DEVELOPMENT",
  test: "TEST",
  all: "ALL",
  unknown: "UNKNOWN",
} as const;

export const FACT_NEED_TIMEFRAME_KINDS = {
  current: "CURRENT",
  atTime: "AT_TIME",
  range: "RANGE",
  allTime: "ALL_TIME",
} as const;

export const FACT_NEED_VALUE_KINDS = {
  text: "TEXT",
  boolean: "BOOLEAN",
  integer: "INTEGER",
  number: "NUMBER",
  date: "DATE",
  dateTime: "DATE_TIME",
  enumeration: "ENUM",
  json: "JSON",
} as const;

export const FACT_NEED_STATUSES = {
  open: "OPEN",
  resolved: "RESOLVED",
  superseded: "SUPERSEDED",
} as const;

const canonicalSemanticKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

export const factNeedTimeframeSchema = z
  .strictObject({
    kind: z.enum(FACT_NEED_TIMEFRAME_KINDS),
    from: z.iso.datetime().nullable(),
    to: z.iso.datetime().nullable(),
  })
  .superRefine((timeframe, context) => {
    const hasFrom = timeframe.from !== null;
    const hasTo = timeframe.to !== null;
    if (
      (timeframe.kind === FACT_NEED_TIMEFRAME_KINDS.current ||
        timeframe.kind === FACT_NEED_TIMEFRAME_KINDS.allTime) &&
      (hasFrom || hasTo)
    ) {
      context.addIssue({
        code: "custom",
        message: "CURRENT and ALL_TIME must not provide explicit bounds",
      });
    }
    if (
      timeframe.kind === FACT_NEED_TIMEFRAME_KINDS.atTime &&
      (!hasFrom || hasTo)
    ) {
      context.addIssue({
        code: "custom",
        message: "AT_TIME requires from and forbids to",
      });
    }
    if (
      timeframe.kind === FACT_NEED_TIMEFRAME_KINDS.range &&
      (!timeframe.from || !timeframe.to || timeframe.from > timeframe.to)
    ) {
      context.addIssue({
        code: "custom",
        message: "RANGE requires ordered from and to bounds",
      });
    }
  });

export const factNeedValueSchema = z
  .strictObject({
    kind: z.enum(FACT_NEED_VALUE_KINDS),
    schemaVersion: canonicalSemanticKeySchema,
    allowedValues: z.array(canonicalSemanticKeySchema).max(100),
  })
  .superRefine((schema, context) => {
    if (
      schema.kind === FACT_NEED_VALUE_KINDS.enumeration &&
      schema.allowedValues.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "ENUM requires at least one canonical allowed value",
      });
    }
    if (
      schema.kind !== FACT_NEED_VALUE_KINDS.enumeration &&
      schema.allowedValues.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Only ENUM may define allowed values",
      });
    }
    if (new Set(schema.allowedValues).size !== schema.allowedValues.length) {
      context.addIssue({
        code: "custom",
        message: "allowedValues must be unique",
      });
    }
  });

export const factNeedIdentitySchema = z.strictObject({
  subject: z.strictObject({
    kind: z.enum(FACT_NEED_SUBJECT_KINDS),
    key: canonicalSemanticKeySchema,
  }),
  predicate: canonicalSemanticKeySchema,
  operationalScope: canonicalSemanticKeySchema,
  environment: z.strictObject({
    kind: z.enum(FACT_NEED_ENVIRONMENTS),
    deploymentKey: canonicalSemanticKeySchema.nullable(),
  }),
  timeframe: factNeedTimeframeSchema,
  valueSchema: factNeedValueSchema,
});
export type FactNeedIdentity = z.infer<typeof factNeedIdentitySchema>;

export const factNeedInputSchema = factNeedIdentitySchema.extend({
  sourceInvestigationAttempts: z
    .array(z.string().trim().min(1).max(2_000))
    .min(1)
    .max(100),
  acceptedEvidenceIds: z.array(z.uuid()).max(100),
  investigatedRangeIds: z
    .array(z.string().regex(/^sha256:[a-f0-9]{64}$/))
    .max(500),
});
export type FactNeedInput = z.infer<typeof factNeedInputSchema>;

export const factNeedViewSchema = factNeedInputSchema.extend({
  factNeedId: z.uuid(),
  identityDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: z.enum(FACT_NEED_STATUSES),
  resolvedFactId: z.uuid().nullable(),
});
export type FactNeedView = z.infer<typeof factNeedViewSchema>;
