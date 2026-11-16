import { z } from "zod";
import { LEGAL_DOCUMENT_NODE_TYPES } from "../legal-source/document-graph.ts";
import { preparationSourceUnitAncestorSchema } from "./preparation-source-units.ts";

const uuid = z.string().uuid();
const opaqueId = z.string().min(1).max(256);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);

export const PREPARATION_SOURCE_CONTENT = {
  DEFAULT_PAGE_SIZE: 8000,
  MAX_PAGE_SIZE: 12000,
  MIN_PAGE_SIZE: 256,
  MAX_CHILDREN: 100,
} as const;

export const PREPARATION_SOURCE_CONTENT_AVAILABILITY = {
  AVAILABLE: "AVAILABLE",
  EMPTY: "EMPTY",
} as const;

export const preparationSourceContentRequestSchema = z.strictObject({
  inventoryRevision: z.coerce.number().int().positive(),
  limit: z.coerce
    .number()
    .int()
    .min(PREPARATION_SOURCE_CONTENT.MIN_PAGE_SIZE)
    .max(PREPARATION_SOURCE_CONTENT.MAX_PAGE_SIZE)
    .default(PREPARATION_SOURCE_CONTENT.DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).max(2048).optional(),
});
export type PreparationSourceContentRequest = z.infer<
  typeof preparationSourceContentRequestSchema
>;

const sourceNodeSchema = z.strictObject({
  sourceNodeId: opaqueId,
  nodeType: z.enum(LEGAL_DOCUMENT_NODE_TYPES),
  structuralPath: z.string().min(1).max(2048),
  ordinal: z.number().int().nonnegative(),
  label: z.string().max(512),
  title: z.string().max(512),
});

export const preparationSourceContentResponseSchema = z.strictObject({
  preparationRunId: uuid,
  inventoryRevision: z.number().int().positive(),
  legalSourceVersionId: uuid,
  materializationId: opaqueId,
  sourceNodeId: opaqueId,
  documentId: z.string().min(1).max(256),
  nodeType: z.enum(LEGAL_DOCUMENT_NODE_TYPES),
  parentNodeId: opaqueId.nullable(),
  structuralPath: z.string().min(1).max(2048),
  sourcePath: z.string().max(2048),
  ordinal: z.number().int().nonnegative(),
  label: z.string().max(512),
  title: z.string().max(512),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  charStart: z.number().int().nonnegative().nullable(),
  charEnd: z.number().int().nonnegative().nullable(),
  ancestors: z.array(preparationSourceUnitAncestorSchema).max(8),
  children: z
    .array(sourceNodeSchema)
    .max(PREPARATION_SOURCE_CONTENT.MAX_CHILDREN),
  childrenTruncated: z.boolean(),
  contentFingerprint: fingerprint,
  contentLength: z.number().int().nonnegative(),
  availability: z.enum([
    PREPARATION_SOURCE_CONTENT_AVAILABILITY.AVAILABLE,
    PREPARATION_SOURCE_CONTENT_AVAILABILITY.EMPTY,
  ]),
  offset: z.number().int().nonnegative(),
  content: z.string().max(PREPARATION_SOURCE_CONTENT.MAX_PAGE_SIZE),
  nextCursor: z.string().min(1).max(2048).nullable(),
  complete: z.boolean(),
});
export type PreparationSourceContentResponse = z.infer<
  typeof preparationSourceContentResponseSchema
>;
