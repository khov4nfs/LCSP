import { z } from "zod";
import { LEGAL_DOCUMENT_NODE_TYPES } from "../legal-source/document-graph.ts";
import {
  SOURCE_REVIEW_DISPOSITIONS,
  SOURCE_REVIEW_STATES,
} from "../legal-source/review-frontier.ts";

const uuid = z.string().uuid();
const opaqueId = z.string().min(1).max(256);

/** Query contract for one immutable Preparation review-frontier snapshot. */
export const preparationSourceUnitsRequestSchema = z.strictObject({
  inventoryRevision: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+$/u)
    .optional(),
  state: z.enum(SOURCE_REVIEW_STATES).optional(),
  documentId: z.string().trim().min(1).max(128).optional(),
  search: z.string().trim().max(128).optional(),
});
export type PreparationSourceUnitsRequest = z.infer<
  typeof preparationSourceUnitsRequestSchema
>;

const preparationSourceUnitAncestorSchema = z.strictObject({
  sourceNodeId: opaqueId,
  nodeType: z.enum(LEGAL_DOCUMENT_NODE_TYPES),
  structuralPath: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  label: z.string(),
  title: z.string(),
});

export const preparationSourceUnitSchema = z.strictObject({
  sourceNodeId: opaqueId,
  legalSourceVersionId: uuid,
  materializationId: opaqueId,
  documentId: z.string().min(1),
  nodeType: z.enum(LEGAL_DOCUMENT_NODE_TYPES),
  parentNodeId: opaqueId.nullable(),
  structuralPath: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  label: z.string(),
  title: z.string(),
  ancestors: z.array(preparationSourceUnitAncestorSchema).max(8),
  state: z.enum(SOURCE_REVIEW_STATES),
  disposition: z.enum(SOURCE_REVIEW_DISPOSITIONS).nullable(),
  claimCount: z.number().int().nonnegative(),
  claimIds: z.array(z.string().min(1).max(128)).max(50),
  claimIdsTruncated: z.boolean(),
  referenceCount: z.number().int().nonnegative(),
  blockedReferenceCount: z.number().int().nonnegative(),
  referencesBlocked: z.boolean(),
  completedAt: z.string().datetime().nullable(),
});

export const preparationSourceUnitsResponseSchema = z.strictObject({
  preparationRunId: uuid,
  legalSourceVersionId: uuid,
  inventoryRevision: z.number().int().positive(),
  materializationId: opaqueId,
  frontier: z.strictObject({
    revision: z.number().int().positive(),
    fingerprint: z.string().min(1),
    stateFingerprint: z.string().min(1),
    stateAccumulator: z.string().min(1),
    frozenAt: z.string().datetime().nullable(),
    coverage: z.strictObject({
      total: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      inReview: z.number().int().nonnegative(),
      reviewedWithClaims: z.number().int().nonnegative(),
      reviewedNoClaims: z.number().int().nonnegative(),
      blockedReferences: z.number().int().nonnegative(),
      persistedClaims: z.number().int().nonnegative(),
    }),
  }),
  units: z.array(preparationSourceUnitSchema).max(100),
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(4096).nullable(),
});
export type PreparationSourceUnitsResponse = z.infer<
  typeof preparationSourceUnitsResponseSchema
>;
