import { z } from "zod";
import { ruleSetPreparationAuthoringDraftSchema } from "./schemas.ts";
import {
  SOURCE_REVIEW_ACTIONS,
  SOURCE_REVIEW_DISPOSITIONS,
} from "../legal-source/review-frontier.ts";
import {
  legalSemanticGraphSchema,
  legalSemanticClaimSchema,
} from "./semantic-graph.ts";

export const CLAIM_DISCOVERY_MODES = {
  CLAIM_DISCOVERY_ONLY: "CLAIM_DISCOVERY_ONLY",
} as const;

const id = z.string().min(1).max(128);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceReviewPayloadSchema = z.strictObject({
  claims: z.array(legalSemanticClaimSchema).max(256),
  identities: z.record(id, z.string().trim().min(1).max(128)),
  relations: legalSemanticGraphSchema.shape.relations,
  referenceAccounting: legalSemanticGraphSchema.shape.referenceAccounting,
  // Runtime-owned authority snapshots; Agent intent remains in claims/relations.
  dependencyFingerprints: z.record(id, hash).optional(),
  blockedEndpointFingerprints: z.record(id, hash).optional(),
  // Reopened units a reference-less yield waits for; set by the API, never by the Agent.
  blockedSourceNodeIds: z.array(hash).max(20000).optional(),
  invalidatedRelationIds: z.array(id).max(20000).optional(),
});
export const unitReviewCompletionSchema = z.strictObject({
  sourceNodeId: hash,
  disposition: z.enum(SOURCE_REVIEW_DISPOSITIONS),
  claimIds: z.array(id).max(256),
  reason: z.string().trim().min(1).max(2000).optional(),
  referenceIds: z.array(hash).max(128).optional(),
  payload: sourceReviewPayloadSchema,
});
export type UnitReviewCompletion = z.infer<typeof unitReviewCompletionSchema>;

export const sourceReviewOperationSchema = z.strictObject({
  preparationRunId: z.string().uuid(),
  inventoryRevision: z.number().int().positive(),
  action: z.enum(SOURCE_REVIEW_ACTIONS),
  operationId: z.string().uuid(),
  sourceRevision: hash.optional(),
  frontierRevision: z.number().int().positive().optional(),
  sourceNodeId: hash.optional(),
  claimIds: z.array(id).max(256).optional(),
  disposition: z.enum(SOURCE_REVIEW_DISPOSITIONS).optional(),
  reason: z.string().trim().min(1).max(2000).optional(),
  referenceIds: z.array(hash).max(128).optional(),
  scopeNodeIds: z.array(hash).min(1).max(20000).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  batch: z.array(unitReviewCompletionSchema).min(1).max(20000).optional(),
  updatedSince: z.string().datetime().optional(),
  updatedThrough: z.string().datetime().optional(),
  payload: sourceReviewPayloadSchema.optional(),
  draft: ruleSetPreparationAuthoringDraftSchema.optional(),
  draftVersion: z.number().int().nonnegative().optional(),
});
export type SourceReviewOperation = z.infer<typeof sourceReviewOperationSchema>;
export type SourceReviewPayload = z.infer<typeof sourceReviewPayloadSchema>;
export const claimDiscoveryDiagnosticRequestSchema = z.strictObject({
  legalSourceVersionId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200),
});
