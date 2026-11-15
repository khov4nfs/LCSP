import { z } from "zod";
import { LEGAL_DOCUMENT_NODE_TYPES } from "../legal-source/document-graph.ts";
import {
  SOURCE_REVIEW_DISPOSITIONS,
  SOURCE_REVIEW_STATES,
} from "../legal-source/review-frontier.ts";
import { sourceReviewPayloadSchema } from "./preparation-frontier.ts";
import { preparationSourceUnitAncestorSchema } from "./preparation-source-units.ts";

const uuid = z.string().uuid();
const opaqueId = z.string().min(1).max(256);
const storedClaimSchema = sourceReviewPayloadSchema.shape.claims.element;
const storedRelationSchema = sourceReviewPayloadSchema.shape.relations.element;
const storedAccountingSchema =
  sourceReviewPayloadSchema.shape.referenceAccounting.element;

export const SOURCE_UNIT_DETAIL_AVAILABILITY = {
  AVAILABLE: "AVAILABLE",
  EMPTY: "EMPTY",
  UNAVAILABLE: "UNAVAILABLE",
} as const;

export const SOURCE_UNIT_DETAIL_MAPPING_REASONS = {
  RULE_SET_NOT_SUBMITTED: "RULE_SET_NOT_SUBMITTED",
  PINNED_SEMANTIC_GRAPH_UNAVAILABLE: "PINNED_SEMANTIC_GRAPH_UNAVAILABLE",
} as const;

export const SOURCE_UNIT_DETAIL_ERROR_CODES = {
  sourceUnitNotFound: "RULE_SET_PREPARATION_SOURCE_UNIT_NOT_FOUND",
  persistedPayloadInvalid: "RULE_SET_PREPARATION_SOURCE_REVIEW_PAYLOAD_INVALID",
} as const;

export const preparationSourceUnitDetailRequestSchema = z.strictObject({
  inventoryRevision: z.coerce.number().int().positive(),
});
export const preparationSourceNodeIdSchema = z.string().trim().min(1).max(256);
export type PreparationSourceUnitDetailRequest = z.infer<
  typeof preparationSourceUnitDetailRequestSchema
>;

const detailClaimSchema = z.strictObject({
  claimId: z.string().min(1).max(128),
  legalSourceVersionId: uuid,
  sourceNodeIds: z.array(opaqueId).max(32),
  sourceNodeIdsTruncated: z.boolean(),
  claimType: storedClaimSchema.shape.claimType,
  statement: z.string().min(1).max(4000),
  state: storedClaimSchema.shape.state,
  semanticAuthority: storedClaimSchema.shape.semanticAuthority,
  assessability: storedClaimSchema.shape.assessability,
  nonOperativeReason: z.string().max(1000).nullable(),
  sourceSupport: z
    .array(
      z.strictObject({
        nodeId: opaqueId,
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().nonnegative(),
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    )
    .max(32),
  sourceSupportTruncated: z.boolean(),
});

const detailRelationSchema = storedRelationSchema.pick({
  relationId: true,
  kind: true,
  fromClaimId: true,
  toClaimId: true,
  referenceId: true,
});

const detailReferenceAccountingSchema = storedAccountingSchema
  .pick({
    referenceId: true,
    material: true,
    relationIds: true,
    nonMaterialReason: true,
  })
  .extend({
    relationIds: z.array(opaqueId).max(100),
    relationIdsTruncated: z.boolean(),
    nonMaterialReason: z.string().max(1000).nullable(),
  });

const boundedIdentitySchema = z
  .record(z.string().min(1).max(128), z.string().min(1).max(256))
  .refine((value) => Object.keys(value).length <= 100);

export const preparationSourceUnitDetailResponseSchema = z.strictObject({
  preparationRunId: uuid,
  inventoryRevision: z.number().int().positive(),
  legalSourceVersionId: uuid,
  materializationId: opaqueId,
  sourceNodeId: opaqueId,
  documentId: z.string().min(1).max(256),
  nodeType: z.enum(LEGAL_DOCUMENT_NODE_TYPES),
  parentNodeId: opaqueId.nullable(),
  structuralPath: z.string().min(1).max(2048),
  ordinal: z.number().int().nonnegative(),
  label: z.string().max(512),
  title: z.string().max(512),
  ancestors: z.array(preparationSourceUnitAncestorSchema).max(8),
  review: z.strictObject({
    state: z.enum(SOURCE_REVIEW_STATES),
    disposition: z.enum(SOURCE_REVIEW_DISPOSITIONS).nullable(),
    reason: z.string().max(1000).nullable(),
    reasonTruncated: z.boolean(),
    completedAt: z.string().datetime().nullable(),
    claimCount: z.number().int().nonnegative(),
    claimIds: z.array(opaqueId).max(100),
    claimIdsTruncated: z.boolean(),
    referenceCount: z.number().int().nonnegative(),
    referenceIds: z.array(opaqueId).max(100),
    referenceIdsTruncated: z.boolean(),
    blockedReferenceCount: z.number().int().nonnegative(),
    blockedReferenceIds: z.array(opaqueId).max(100),
    blockedReferenceIdsTruncated: z.boolean(),
  }),
  output: z.strictObject({
    availability: z.enum([
      SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE,
      SOURCE_UNIT_DETAIL_AVAILABILITY.EMPTY,
    ]),
    claims: z.array(detailClaimSchema).max(100),
    claimsTruncated: z.boolean(),
    identities: boundedIdentitySchema,
    relations: z.array(detailRelationSchema).max(100),
    relationsTruncated: z.boolean(),
    referenceAccounting: z.array(detailReferenceAccountingSchema).max(100),
    referenceAccountingTruncated: z.boolean(),
    identitiesTruncated: z.boolean(),
  }),
  provenance: z.strictObject({
    directClaimIds: z.array(opaqueId).max(100),
    requirementRuleMapping: z.strictObject({
      availability: z.enum([
        SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE,
        SOURCE_UNIT_DETAIL_AVAILABILITY.UNAVAILABLE,
      ]),
      unavailableReason: z
        .enum([
          SOURCE_UNIT_DETAIL_MAPPING_REASONS.RULE_SET_NOT_SUBMITTED,
          SOURCE_UNIT_DETAIL_MAPPING_REASONS.PINNED_SEMANTIC_GRAPH_UNAVAILABLE,
        ])
        .nullable(),
      associations: z
        .array(
          z.strictObject({
            claimId: opaqueId,
            legalRequirementId: opaqueId,
            assessmentRuleIds: z.array(opaqueId).max(50),
          }),
        )
        .max(100),
      associationsTruncated: z.boolean(),
    }),
  }),
});
export type PreparationSourceUnitDetailResponse = z.infer<
  typeof preparationSourceUnitDetailResponseSchema
>;
