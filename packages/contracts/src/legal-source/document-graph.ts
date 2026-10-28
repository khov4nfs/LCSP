import { z } from "zod";
import {
  LEGAL_SOURCE_CHUNK_STATUSES,
  legalSourceExtractionGapSchema,
} from "./management.ts";

export const LEGAL_DOCUMENT_NODE_TYPES = {
  DOCUMENT: "DOCUMENT",
  PART: "PART",
  TITLE: "TITLE",
  CHAPTER: "CHAPTER",
  SUBCHAPTER: "SUBCHAPTER",
  SECTION: "SECTION",
  SUBSECTION: "SUBSECTION",
  ARTICLE: "ARTICLE",
  CLAUSE: "CLAUSE",
  PARAGRAPH: "PARAGRAPH",
  SUBPARAGRAPH: "SUBPARAGRAPH",
  POINT: "POINT",
  ITEM: "ITEM",
  ANNEX: "ANNEX",
  SCHEDULE: "SCHEDULE",
  TABLE: "TABLE",
  DEFINITION_BLOCK: "DEFINITION_BLOCK",
  UNSTRUCTURED_BLOCK: "UNSTRUCTURED_BLOCK",
} as const;
export type LegalDocumentNodeType =
  (typeof LEGAL_DOCUMENT_NODE_TYPES)[keyof typeof LEGAL_DOCUMENT_NODE_TYPES];

export const LEGAL_REFERENCE_RESOLUTION_STATES = {
  RESOLVED: "RESOLVED",
  AMBIGUOUS: "AMBIGUOUS",
  UNRESOLVED: "UNRESOLVED",
} as const;
export const LEGAL_DOCUMENT_GRAPH = {
  parserRevision: "legal-structure-v5",
  materializationRevision: "legal-graph-v2",
  maxContextNodes: 20,
  maxContextCharacters: 24000,
  maxSearchResults: 50,
  retrievalWindowCharacters: 6000,
} as const;
export const LEGAL_GRAPH_INPUT_MODES = {
  EXTRACTED_TEXT: "EXTRACTED_TEXT",
  LEGACY_CHUNK_ADAPTER: "LEGACY_CHUNK_ADAPTER",
} as const;
export const LEGAL_GRAPH_ERROR_CODES = {
  sourceNotFound: "LEGAL_GRAPH_SOURCE_NOT_FOUND",
  invalid: "LEGAL_GRAPH_INVALID",
  notMaterialized: "LEGAL_GRAPH_NOT_MATERIALIZED",
  nodeNotFound: "LEGAL_GRAPH_NODE_NOT_FOUND",
  revisionConflict: "LEGAL_GRAPH_REVISION_CONFLICT",
} as const;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const legalDocumentNodeSchema = z.strictObject({
  nodeId: hash,
  legalSourceVersionId: z.string().uuid(),
  documentId: z.string().min(1),
  nodeType: z.enum(LEGAL_DOCUMENT_NODE_TYPES),
  parentNodeId: hash.nullable(),
  ordinal: z.number().int().nonnegative(),
  label: z.string(),
  title: z.string(),
  structuralPath: z.string().min(1),
  sourcePath: z.string().min(1),
  content: z.string(),
  contentFingerprint: hash,
  legalEffectStatus: z.enum(LEGAL_SOURCE_CHUNK_STATUSES),
  legalStatusSourceRefs: z.array(z.string().min(1)),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  charStart: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe(
      "UTF-16 offset in immutable extracted document text; null when historical physical offsets are unavailable.",
    ),
  charEnd: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Exclusive UTF-16 document offset."),
});
export type LegalDocumentNode = z.infer<typeof legalDocumentNodeSchema>;
export const legalDocumentReferenceSchema = z.strictObject({
  referenceId: hash,
  fromNodeId: hash,
  toNodeId: hash.nullable(),
  text: z.string().min(1),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  resolutionState: z.enum(LEGAL_REFERENCE_RESOLUTION_STATES),
  candidateNodeIds: z.array(hash),
});
export type LegalDocumentReference = z.infer<
  typeof legalDocumentReferenceSchema
>;
export const legalChunkNodeMappingSchema = z.strictObject({
  chunkId: z.string().min(1),
  legalDocumentNodeId: hash,
});
export const legalDocumentRetrievalUnitSchema = z.strictObject({
  unitId: hash,
  legalDocumentNodeId: hash,
  ordinal: z.number().int().nonnegative(),
  contentStart: z.number().int().nonnegative(),
  contentEnd: z.number().int().positive(),
  content: z
    .string()
    .min(1)
    .max(LEGAL_DOCUMENT_GRAPH.retrievalWindowCharacters),
  contentSha256: hash,
});
export const legalDocumentGraphSchema = z.strictObject({
  materializationId: hash,
  legalSourceVersionId: z.string().uuid(),
  parserRevision: z.string().min(1),
  materializationRevision: z.string().min(1),
  sourceDigest: hash,
  graphDigest: hash,
  inputModes: z.array(z.enum(LEGAL_GRAPH_INPUT_MODES)),
  extractionGaps: z
    .array(
      legalSourceExtractionGapSchema.extend({ documentId: z.string().min(1) }),
    )
    .optional(),
  referenceOnlyDocumentIds: z.array(z.string().min(1)).optional(),
  nodes: z.array(legalDocumentNodeSchema),
  references: z.array(legalDocumentReferenceSchema),
  chunkMappings: z.array(legalChunkNodeMappingSchema),
  retrievalUnits: z.array(legalDocumentRetrievalUnitSchema),
});
export type LegalDocumentGraph = z.infer<typeof legalDocumentGraphSchema>;

export const LEGAL_GRAPH_TRAVERSALS = {
  DOCUMENTS: "DOCUMENTS",
  STRUCTURE: "STRUCTURE",
  DESCENDANTS: "DESCENDANTS",
  NODE: "NODE",
  PARENT: "PARENT",
  CHILDREN: "CHILDREN",
  SIBLINGS: "SIBLINGS",
  ANCESTORS: "ANCESTORS",
  REFERENCES: "REFERENCES",
  REFERENCED_BY: "REFERENCED_BY",
  CHUNKS: "CHUNKS",
  CONTEXT: "CONTEXT",
} as const;
export const legalGraphQuerySchema = z
  .strictObject({
    nodeId: hash.optional(),
    materializationId: hash.optional(),
    documentId: z.string().trim().min(1).max(500).optional(),
    locator: z.string().trim().min(1).max(500).optional(),
    nodeType: z.enum(LEGAL_DOCUMENT_NODE_TYPES).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    traversal: z
      .enum(LEGAL_GRAPH_TRAVERSALS)
      .default(LEGAL_GRAPH_TRAVERSALS.NODE),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    contentOffset: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => Boolean(v.nodeId || v.query || v.documentId || v.traversal === LEGAL_GRAPH_TRAVERSALS.DOCUMENTS), "nodeId, query or documentId required")
  .refine((v) => !v.locator || Boolean(v.documentId), "locator requires documentId");
export type LegalGraphQuery = z.infer<typeof legalGraphQuerySchema>;
