import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  PREPARATION_SOURCE_CONTENT,
  PREPARATION_SOURCE_CONTENT_AVAILABILITY,
  SOURCE_UNIT_DETAIL_AVAILABILITY,
  SOURCE_UNIT_DETAIL_ERROR_CODES,
  SOURCE_UNIT_DETAIL_MAPPING_REASONS,
  preparationSourceContentResponseSchema,
  preparationSourceUnitDetailResponseSchema,
  preparationSourceUnitsResponseSchema,
  type PreparationSourceContentRequest,
  type PreparationSourceContentResponse,
  type PreparationSourceUnitDetailResponse,
  type PreparationSourceUnitDetailRequest,
  type PreparationSourceUnitsRequest,
  type PreparationSourceUnitsResponse,
} from "@lcsp/contracts/compliance-rule-set";
import { sourceReviewPayloadSchema } from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_GRAPH_ERROR_CODES,
  SOURCE_REVIEW_STATES,
} from "@lcsp/contracts/legal-source";
import { Prisma } from "@prisma/client";
import { HttpStatus, Injectable } from "@nestjs/common";
import { z } from "zod";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";

const cursorSchema = z.strictObject({
  version: z.literal(1),
  preparationRunId: z.string().uuid(),
  inventoryRevision: z.number().int().positive(),
  legalSourceVersionId: z.string().uuid(),
  materializationId: z.string().min(1).max(256),
  frontierRevision: z.number().int().positive(),
  fingerprint: z.string().min(1).max(256),
  stateFingerprint: z.string().min(1).max(256),
  stateAccumulator: z.string().min(1).max(256),
  state: z.enum(SOURCE_REVIEW_STATES).optional(),
  documentId: z.string().min(1).max(128).optional(),
  search: z.string().max(256).optional(),
  ordinal: z.number().int().nonnegative(),
  sourceNodeId: z.string().min(1).max(256),
});
type Cursor = z.infer<typeof cursorSchema>;

const contentCursorSchema = z.strictObject({
  version: z.literal(1),
  preparationRunId: z.string().uuid(),
  inventoryRevision: z.number().int().positive(),
  legalSourceVersionId: z.string().uuid(),
  materializationId: z.string().min(1).max(256),
  frontierRevision: z.number().int().positive(),
  frontierFingerprint: z.string().min(1).max(256),
  sourceNodeId: z.string().min(1).max(256),
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  offset: z.number().int().positive(),
});
type ContentCursor = z.infer<typeof contentCursorSchema>;

type NodeProjection = {
  nodeId: string;
  nodeType: string;
  parentNodeId: string | null;
  structuralPath: string;
  ordinal: number;
  label: string;
  title: string;
};

type AncestorProjection = {
  sourceNodeId: string;
  nodeType: string;
  structuralPath: string;
  ordinal: number;
  label: string;
  title: string;
};

@Injectable()
export class PreparationSourceAnalysisReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Read one bounded page of the exact legal-source node text pinned by a Preparation frontier.
   *
   * Business rules:
   * - The run owns the Legal Source Version and the requested persisted frontier owns the materialization; the node must match both identities.
   * - Continuation cursors bind the exact run, inventory frontier, source version, materialization, node, content fingerprint, and UTF-16 offset.
   * - Any node in the pinned materialization may be viewed as legal text, whether or not that node has a SourceReview row.
   *
   * Execution flow:
   * 1. Load the exact run and inventory frontier in a repeatable-read transaction.
   * 2. Resolve the node only within the frontier materialization and run Legal Source Version.
   * 3. Validate every cursor pin, return one bounded text slice, and project pinned ancestors and persisted children for navigation.
   * 4. Validate the bounded response against the shared contract.
   *
   * Failure cases:
   * - Missing run/frontier or mismatched version/materialization returns a typed conflict; a node absent from the pinned graph returns typed not-found.
   * - A malformed, stale, or identity-mismatched cursor, invalid offset boundary, or offset beyond stored text is rejected rather than restarting.
   *
   * Side effects:
   * - Read-only repeatable-read transaction; no graph materialization, legal-source mutation, SourceReview mutation, or worker action occurs.
   */
  async content(
    preparationRunId: string,
    sourceNodeId: string,
    request: PreparationSourceContentRequest,
    correlationId: string,
  ): Promise<PreparationSourceContentResponse> {
    const cursor = request.cursor
      ? decodeContentCursor(request.cursor, correlationId)
      : null;
    return this.prisma.$transaction(
      async (tx) => {
        const run = await tx.ruleSetPreparationRun.findUnique({
          where: { id: preparationRunId },
          select: { id: true, legalSourceVersionId: true },
        });
        if (!run) {
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
            correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }

        const frontier = await tx.ruleSetPreparationReviewFrontier.findUnique({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId,
              inventoryRevision: request.inventoryRevision,
            },
          },
        });
        if (
          !frontier ||
          frontier.legalSourceVersionId !== run.legalSourceVersionId
        ) {
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        const node = await tx.legalDocumentNode.findUnique({
          where: {
            nodeId_materializationId: {
              nodeId: sourceNodeId,
              materializationId: frontier.materializationId,
            },
          },
          select: {
            nodeId: true,
            legalSourceVersionId: true,
            materializationId: true,
            documentId: true,
            nodeType: true,
            parentNodeId: true,
            structuralPath: true,
            sourcePath: true,
            ordinal: true,
            label: true,
            title: true,
            pageStart: true,
            pageEnd: true,
            charStart: true,
            charEnd: true,
            content: true,
            contentFingerprint: true,
          },
        });
        if (!node) {
          throw problemException(
            LEGAL_GRAPH_ERROR_CODES.nodeNotFound,
            correlationId,
            {
              status: HttpStatus.NOT_FOUND,
            },
          );
        }
        if (
          node.legalSourceVersionId !== run.legalSourceVersionId ||
          node.legalSourceVersionId !== frontier.legalSourceVersionId ||
          node.materializationId !== frontier.materializationId
        ) {
          throw problemException(
            LEGAL_GRAPH_ERROR_CODES.revisionConflict,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        const offset = cursor?.offset ?? 0;
        const { limit } = request;
        if (
          (cursor !== null &&
            (cursor.preparationRunId !== preparationRunId ||
              cursor.inventoryRevision !== request.inventoryRevision ||
              cursor.legalSourceVersionId !== run.legalSourceVersionId ||
              cursor.materializationId !== frontier.materializationId ||
              cursor.frontierRevision !== frontier.revision ||
              cursor.frontierFingerprint !== frontier.fingerprint ||
              cursor.sourceNodeId !== sourceNodeId ||
              cursor.contentFingerprint !== node.contentFingerprint)) ||
          offset > node.content.length ||
          (offset > 0 &&
            node.content.charCodeAt(offset) >= 0xdc00 &&
            node.content.charCodeAt(offset) <= 0xdfff &&
            node.content.charCodeAt(offset - 1) >= 0xd800 &&
            node.content.charCodeAt(offset - 1) <= 0xdbff)
        ) {
          throw problemException(
            LEGAL_GRAPH_ERROR_CODES.revisionConflict,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        const page = slicePinnedContent(node.content, offset, limit);
        const nextCursor = page.nextOffset
          ? encodeContentCursor({
              version: 1,
              preparationRunId,
              inventoryRevision: frontier.inventoryRevision,
              legalSourceVersionId: run.legalSourceVersionId,
              materializationId: frontier.materializationId,
              frontierRevision: frontier.revision,
              frontierFingerprint: frontier.fingerprint,
              sourceNodeId: node.nodeId,
              contentFingerprint: node.contentFingerprint,
              offset: page.nextOffset,
            })
          : null;
        const ancestors = await loadAncestors(
          tx,
          [node],
          frontier.materializationId,
          run.legalSourceVersionId,
        );
        const childRows = await tx.legalDocumentNode.findMany({
          where: {
            parentNodeId: node.nodeId,
            materializationId: frontier.materializationId,
            legalSourceVersionId: run.legalSourceVersionId,
          },
          orderBy: [{ ordinal: "asc" }, { nodeId: "asc" }],
          take: PREPARATION_SOURCE_CONTENT.MAX_CHILDREN + 1,
          select: {
            nodeId: true,
            nodeType: true,
            structuralPath: true,
            ordinal: true,
            label: true,
            title: true,
          },
        });

        return preparationSourceContentResponseSchema.parse({
          preparationRunId,
          inventoryRevision: frontier.inventoryRevision,
          legalSourceVersionId: run.legalSourceVersionId,
          materializationId: frontier.materializationId,
          sourceNodeId: node.nodeId,
          documentId: node.documentId,
          nodeType: node.nodeType,
          parentNodeId: node.parentNodeId,
          structuralPath: node.structuralPath,
          sourcePath: node.sourcePath,
          ordinal: node.ordinal,
          label: node.label.slice(0, 512),
          title: node.title.slice(0, 512),
          pageStart: node.pageStart,
          pageEnd: node.pageEnd,
          charStart: node.charStart,
          charEnd: node.charEnd,
          ancestors: ancestors.get(node.nodeId) ?? [],
          children: childRows
            .slice(0, PREPARATION_SOURCE_CONTENT.MAX_CHILDREN)
            .map((child) => ({
              sourceNodeId: child.nodeId,
              nodeType: child.nodeType,
              structuralPath: child.structuralPath,
              ordinal: child.ordinal,
              label: child.label.slice(0, 512),
              title: child.title.slice(0, 512),
            })),
          childrenTruncated:
            childRows.length > PREPARATION_SOURCE_CONTENT.MAX_CHILDREN,
          contentFingerprint: node.contentFingerprint,
          contentLength: node.content.length,
          availability:
            node.content.length > 0
              ? PREPARATION_SOURCE_CONTENT_AVAILABILITY.AVAILABLE
              : PREPARATION_SOURCE_CONTENT_AVAILABILITY.EMPTY,
          offset,
          content: page.content,
          nextCursor,
          complete: page.nextOffset === null,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Business purpose: Return one Admin page from the exact persisted Source Review frontier of a Preparation run.
   *
   * Business rules:
   * - The run owns the Legal Source Version; the requested inventory revision owns the materialization and canonical coverage counters.
   * - Only persisted Source Review rows for that exact run, revision, version and materialization are returned; page filters never redefine global coverage.
   * - A continuation cursor is bound to the frontier state and normalized filters, and cannot silently continue against a changed snapshot.
   *
   * Execution flow:
   * 1. Decode and validate any cursor, then open a repeatable-read transaction.
   * 2. Load the run and exact frontier, verify cursor scope/state, and fetch a bounded stable page of linked LegalDocumentNode metadata.
   * 3. Load at most eight ancestors per returned node and project persisted counts, references and review state into the shared response contract.
   *
   * Failure cases:
   * - Missing run returns RULE_SET_PREPARATION_RUN_NOT_FOUND; missing or inconsistent frontier returns a conflict.
   * - Malformed or scope-mismatched cursors return a typed invalid-request problem; a frontier-state mismatch returns a conflict.
   * - Database, pin, or response-contract failures propagate and do not fabricate source-review outcomes.
   *
   * Side effects:
   * - Read-only PostgreSQL transaction; no graph materialization, lifecycle transition, source-review mutation, or worker action occurs.
   */
  async list(
    preparationRunId: string,
    request: PreparationSourceUnitsRequest,
    correlationId: string,
  ): Promise<PreparationSourceUnitsResponse> {
    const filters = normalizeFilters(request);
    const cursor = request.cursor
      ? decodeCursor(request.cursor, correlationId)
      : null;
    if (
      cursor &&
      (cursor.preparationRunId !== preparationRunId ||
        cursor.inventoryRevision !== request.inventoryRevision ||
        cursor.state !== filters.state ||
        cursor.documentId !== filters.documentId ||
        cursor.search !== filters.search)
    ) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const run = await tx.ruleSetPreparationRun.findUnique({
          where: { id: preparationRunId },
          select: { id: true, legalSourceVersionId: true },
        });
        if (!run)
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
            correlationId,
            { status: HttpStatus.NOT_FOUND },
          );

        const frontier = await tx.ruleSetPreparationReviewFrontier.findUnique({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId,
              inventoryRevision: request.inventoryRevision,
            },
          },
        });
        if (
          !frontier ||
          frontier.legalSourceVersionId !== run.legalSourceVersionId
        )
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );

        if (cursor && !cursorMatchesFrontier(cursor, frontier))
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        if (cursor && cursor.legalSourceVersionId !== run.legalSourceVersionId)
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );

        const nodeConditions: Prisma.LegalDocumentNodeWhereInput[] = [];
        if (filters.documentId) {
          nodeConditions.push({ documentId: filters.documentId });
        }
        if (filters.search) {
          nodeConditions.push({
            OR: [
              {
                documentId: {
                  contains: filters.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                label: {
                  contains: filters.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                title: {
                  contains: filters.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                structuralPath: {
                  contains: filters.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          });
        }

        const where: Prisma.RuleSetPreparationSourceReviewWhereInput = {
          preparationRunId,
          inventoryRevision: request.inventoryRevision,
          materializationId: frontier.materializationId,
          legalSourceVersionId: run.legalSourceVersionId,
          ...(filters.state ? { state: filters.state } : {}),
          ...(nodeConditions.length
            ? { node: { is: { AND: nodeConditions } } }
            : {}),
          ...(cursor
            ? {
                OR: [
                  { ordinal: { gt: cursor.ordinal } },
                  {
                    ordinal: cursor.ordinal,
                    sourceNodeId: { gt: cursor.sourceNodeId },
                  },
                ],
              }
            : {}),
        };
        const rows = await tx.ruleSetPreparationSourceReview.findMany({
          where,
          orderBy: [{ ordinal: "asc" }, { sourceNodeId: "asc" }],
          take: request.limit + 1,
          select: {
            sourceNodeId: true,
            legalSourceVersionId: true,
            materializationId: true,
            structuralPath: true,
            ordinal: true,
            state: true,
            disposition: true,
            ownedClaimCount: true,
            claimIds: true,
            referenceIds: true,
            blockedReferenceIds: true,
            completedAt: true,
            node: {
              select: {
                nodeId: true,
                nodeType: true,
                parentNodeId: true,
                structuralPath: true,
                ordinal: true,
                label: true,
                title: true,
                documentId: true,
              },
            },
          },
        });
        const hasMore = rows.length > request.limit;
        const page = rows.slice(0, request.limit);
        const ancestors = await loadAncestors(
          tx,
          page.map((row) => row.node),
          frontier.materializationId,
          run.legalSourceVersionId,
        );
        const units = page.map((row) => ({
          sourceNodeId: row.sourceNodeId,
          legalSourceVersionId: row.legalSourceVersionId,
          materializationId: row.materializationId,
          documentId: row.node.documentId,
          nodeType: row.node.nodeType,
          parentNodeId: row.node.parentNodeId,
          structuralPath: row.structuralPath,
          ordinal: row.ordinal,
          label: row.node.label,
          title: row.node.title,
          ancestors: ancestors.get(row.sourceNodeId) ?? [],
          state: row.state,
          disposition: row.disposition,
          claimCount: row.ownedClaimCount,
          claimIds: row.claimIds.slice(0, 50),
          claimIdsTruncated: row.claimIds.length > 50,
          referenceCount: row.referenceIds.length,
          blockedReferenceCount: row.blockedReferenceIds.length,
          referencesBlocked: row.blockedReferenceIds.length > 0,
          completedAt: row.completedAt?.toISOString() ?? null,
        }));
        const last = page.at(-1);
        const nextCursor =
          hasMore && last
            ? encodeCursor({
                version: 1,
                preparationRunId,
                inventoryRevision: request.inventoryRevision,
                legalSourceVersionId: run.legalSourceVersionId,
                materializationId: frontier.materializationId,
                frontierRevision: frontier.revision,
                fingerprint: frontier.fingerprint,
                stateFingerprint: frontier.stateFingerprint,
                stateAccumulator: frontier.stateAccumulator,
                ...filters,
                ordinal: last.ordinal,
                sourceNodeId: last.sourceNodeId,
              })
            : null;
        return preparationSourceUnitsResponseSchema.parse({
          preparationRunId,
          legalSourceVersionId: run.legalSourceVersionId,
          inventoryRevision: frontier.inventoryRevision,
          materializationId: frontier.materializationId,
          frontier: {
            revision: frontier.revision,
            fingerprint: frontier.fingerprint,
            stateFingerprint: frontier.stateFingerprint,
            stateAccumulator: frontier.stateAccumulator,
            frozenAt: frontier.frozenAt?.toISOString() ?? null,
            coverage: {
              total: frontier.unitCount,
              pending: frontier.pendingCount,
              inReview: frontier.inReviewCount,
              reviewedWithClaims: frontier.reviewedWithClaimsCount,
              reviewedNoClaims: frontier.reviewedNoClaimsCount,
              blockedReferences: frontier.blockedCount,
              persistedClaims: frontier.persistedClaimCount,
            },
          },
          units,
          hasMore,
          nextCursor,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Business purpose: Return one persisted Source Review result with its pinned graph identity for an Admin reviewer.
   *
   * Business rules:
   * - The requested run, inventory revision, Legal Source Version, frontier materialization, and source-review row must agree exactly.
   * - Only the persisted structured review contract is projected; malformed payloads fail as data-integrity errors and are never represented as empty output.
   * - Requirement and Assessment Rule links are shown only when a submitted semantic graph is pinned to this run's exact source version and materialization.
   *
   * Execution flow:
   * 1. Load the run and requested review frontier in one repeatable-read transaction.
   * 2. Resolve the exact source-review row and its node hierarchy without materializing or refreshing a graph.
   * 3. Validate and bound structured review output, then optionally resolve canonical submitted claim-to-requirement-to-rule identifiers.
   * 4. Validate the complete response against the shared detail DTO before returning it.
   *
   * Failure cases:
   * - Missing run or source unit returns a typed not-found problem; stale or inconsistent pins return a conflict.
   * - Invalid persisted payload ownership or shape returns a server-side typed integrity problem, never a successful empty result.
   *
   * Side effects:
   * - Read-only PostgreSQL transaction; no graph materialization, worker execution, source-review mutation, or lifecycle change occurs.
   */
  async detail(
    preparationRunId: string,
    sourceNodeId: string,
    request: PreparationSourceUnitDetailRequest,
    correlationId: string,
  ): Promise<PreparationSourceUnitDetailResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const run = await tx.ruleSetPreparationRun.findUnique({
          where: { id: preparationRunId },
          select: {
            id: true,
            legalSourceVersionId: true,
            ruleSet: {
              select: {
                id: true,
                legalSourceVersionId: true,
                semanticGraph: {
                  select: {
                    materializationId: true,
                    legalSourceVersionId: true,
                  },
                },
              },
            },
          },
        });
        if (!run)
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
            correlationId,
            { status: HttpStatus.NOT_FOUND },
          );

        const frontier = await tx.ruleSetPreparationReviewFrontier.findUnique({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId,
              inventoryRevision: request.inventoryRevision,
            },
          },
        });
        if (
          !frontier ||
          frontier.legalSourceVersionId !== run.legalSourceVersionId
        )
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );

        const row = await tx.ruleSetPreparationSourceReview.findUnique({
          where: {
            preparationRunId_inventoryRevision_sourceNodeId: {
              preparationRunId,
              inventoryRevision: request.inventoryRevision,
              sourceNodeId,
            },
          },
          select: {
            sourceNodeId: true,
            legalSourceVersionId: true,
            materializationId: true,
            structuralPath: true,
            ordinal: true,
            state: true,
            disposition: true,
            reason: true,
            claimIds: true,
            ownedClaimCount: true,
            referenceIds: true,
            blockedReferenceIds: true,
            payload: true,
            completedAt: true,
            node: {
              select: {
                nodeId: true,
                nodeType: true,
                parentNodeId: true,
                structuralPath: true,
                ordinal: true,
                label: true,
                title: true,
                documentId: true,
              },
            },
          },
        });
        if (!row)
          throw problemException(
            SOURCE_UNIT_DETAIL_ERROR_CODES.sourceUnitNotFound,
            correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        if (
          row.legalSourceVersionId !== run.legalSourceVersionId ||
          row.legalSourceVersionId !== frontier.legalSourceVersionId ||
          row.materializationId !== frontier.materializationId ||
          row.node.nodeId !== row.sourceNodeId
        )
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );

        const parsedPayload = sourceReviewPayloadSchema.safeParse(row.payload);
        if (!parsedPayload.success)
          throw problemException(
            SOURCE_UNIT_DETAIL_ERROR_CODES.persistedPayloadInvalid,
            correlationId,
            { status: HttpStatus.INTERNAL_SERVER_ERROR },
          );
        const payload = parsedPayload.data;
        const payloadClaimIds = payload.claims.map((claim) => claim.claimId);
        const storedClaimIds = [...row.claimIds].sort();
        const parsedClaimIds = [...payloadClaimIds].sort();
        const identityIds = Object.keys(payload.identities).sort();
        const supportedNodeIds = [
          ...new Set(
            payload.claims.flatMap((claim) => [
              ...claim.sourceNodeIds,
              ...(claim.sourceSupport ?? []).map((support) => support.nodeId),
            ]),
          ),
        ];
        const supportedNodes = supportedNodeIds.length
          ? await tx.legalDocumentNode.findMany({
              where: {
                nodeId: { in: supportedNodeIds },
                materializationId: frontier.materializationId,
                legalSourceVersionId: run.legalSourceVersionId,
              },
              select: { nodeId: true },
            })
          : [];
        const pinnedNodeIds = new Set(
          supportedNodes.map((node) => node.nodeId),
        );
        if (
          row.ownedClaimCount !== row.claimIds.length ||
          new Set(payloadClaimIds).size !== payloadClaimIds.length ||
          JSON.stringify(storedClaimIds) !== JSON.stringify(parsedClaimIds) ||
          JSON.stringify(storedClaimIds) !== JSON.stringify(identityIds) ||
          payload.claims.some(
            (claim) => claim.legalSourceVersionId !== run.legalSourceVersionId,
          ) ||
          supportedNodeIds.some((nodeId) => !pinnedNodeIds.has(nodeId))
        )
          throw problemException(
            SOURCE_UNIT_DETAIL_ERROR_CODES.persistedPayloadInvalid,
            correlationId,
            { status: HttpStatus.INTERNAL_SERVER_ERROR },
          );

        const ancestors = await loadAncestors(
          tx,
          [row.node],
          frontier.materializationId,
          run.legalSourceVersionId,
        );
        const detail = projectSourceUnitDetail({
          preparationRunId,
          inventoryRevision: frontier.inventoryRevision,
          legalSourceVersionId: run.legalSourceVersionId,
          materializationId: frontier.materializationId,
          row,
          ancestors: ancestors.get(sourceNodeId) ?? [],
          payload,
          requirementRuleMapping: await loadRequirementRuleMapping(
            tx,
            run.ruleSet,
            frontier.materializationId,
            run.legalSourceVersionId,
            sourceNodeId,
            payloadClaimIds,
          ),
        });
        return preparationSourceUnitDetailResponseSchema.parse(detail);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

/**
 * Business purpose: Preserve the complete source-read identity across bounded legal-text pages.
 *
 * Business rules:
 * - The token includes the exact run, inventory frontier, source version, materialization, node, content fingerprint, and next offset.
 * - Tokens are encoded only after the current persisted pins have been verified.
 *
 * Execution flow:
 * 1. Serialize the validated identity object as UTF-8 JSON.
 * 2. Encode it as base64url for safe use as one query parameter.
 *
 * Failure cases:
 * - The caller supplies only values validated by the content cursor schema.
 *
 * Side effects:
 * - Pure token encoding; no database or external state is changed.
 */
function encodeContentCursor(cursor: ContentCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Business purpose: Reject content continuations that cannot be tied to a valid pinned source snapshot.
 *
 * Business rules:
 * - A cursor must decode to the strict, versioned identity contract; malformed or extra fields are rejected.
 * - The content service later compares every cursor pin with the selected run, frontier, node, and persisted fingerprint.
 *
 * Execution flow:
 * 1. Decode base64url UTF-8 JSON.
 * 2. Validate the decoded object against the strict content cursor schema.
 * 3. Return only the validated cursor value.
 *
 * Failure cases:
 * - Invalid encoding, JSON, shape, or identity fields produce a typed stale-source conflict.
 *
 * Side effects:
 * - Pure token validation; no database or external state is changed.
 */
function decodeContentCursor(
  value: string,
  correlationId: string,
): ContentCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw problemException(
      LEGAL_GRAPH_ERROR_CODES.revisionConflict,
      correlationId,
      {
        status: HttpStatus.CONFLICT,
      },
    );
  }
  const parsed = contentCursorSchema.safeParse(decoded);
  if (!parsed.success) {
    throw problemException(
      LEGAL_GRAPH_ERROR_CODES.revisionConflict,
      correlationId,
      {
        status: HttpStatus.CONFLICT,
      },
    );
  }
  return parsed.data;
}

/**
 * Business purpose: Return one exact, bounded UTF-16 slice of immutable pinned legal-source content.
 *
 * Business rules:
 * - The requested offset is preserved, and a page boundary must not split a Unicode surrogate pair.
 * - The content is neither normalized nor summarized; the returned chunks concatenate to the persisted text.
 *
 * Execution flow:
 * 1. Calculate a tentative end from the requested offset and bounded page size.
 * 2. Move the end back one code unit only when it would divide a surrogate pair.
 * 3. Return the exact slice and its next continuation offset, if any.
 *
 * Failure cases:
 * - The caller rejects out-of-range or mid-surrogate offsets before invoking this pure projection.
 *
 * Side effects:
 * - Pure string projection; no database or external state is changed.
 */
function slicePinnedContent(content: string, offset: number, limit: number) {
  let end = Math.min(offset + limit, content.length);
  if (
    end < content.length &&
    end > offset &&
    content.charCodeAt(end - 1) >= 0xd800 &&
    content.charCodeAt(end - 1) <= 0xdbff &&
    content.charCodeAt(end) >= 0xdc00 &&
    content.charCodeAt(end) <= 0xdfff
  ) {
    end -= 1;
  }
  return {
    content: content.slice(offset, end),
    nextOffset: end < content.length ? end : null,
  };
}

const DETAIL_LIST_LIMIT = 100;

/**
 * Business purpose: Bound persisted structured review output into the Admin detail DTO.
 *
 * Business rules:
 * - Preserve canonical identifiers and the validated source-review structure while omitting unapproved payload fields.
 * - Truncation is explicit; content is never invented, and empty valid results remain distinguishable from unavailable mappings.
 *
 * Execution flow:
 * 1. Select bounded claims, identities, relations, references, reason, and hierarchy data from the validated persisted row.
 * 2. Add truncation flags and the already pin-checked requirement/rule mapping.
 *
 * Failure cases:
 * - The caller validates persisted payload ownership before projection; response-contract violations propagate as integrity failures.
 *
 * Side effects:
 * - Pure in-memory DTO projection; no database or external state is changed.
 */
function projectSourceUnitDetail(input: {
  preparationRunId: string;
  inventoryRevision: number;
  legalSourceVersionId: string;
  materializationId: string;
  row: {
    sourceNodeId: string;
    structuralPath: string;
    ordinal: number;
    state: string;
    disposition: string | null;
    reason: string | null;
    claimIds: string[];
    ownedClaimCount: number;
    referenceIds: string[];
    blockedReferenceIds: string[];
    completedAt: Date | null;
    node: NodeProjection & { documentId: string };
  };
  ancestors: AncestorProjection[];
  payload: z.infer<typeof sourceReviewPayloadSchema>;
  requirementRuleMapping: {
    availability: PreparationSourceUnitDetailResponse["provenance"]["requirementRuleMapping"]["availability"];
    unavailableReason: PreparationSourceUnitDetailResponse["provenance"]["requirementRuleMapping"]["unavailableReason"];
    associations: Array<{
      claimId: string;
      legalRequirementId: string;
      assessmentRuleIds: string[];
    }>;
  };
}) {
  const { row, payload } = input;
  const claims = payload.claims.slice(0, DETAIL_LIST_LIMIT).map((claim) => ({
    claimId: claim.claimId,
    legalSourceVersionId: claim.legalSourceVersionId,
    sourceNodeIds: claim.sourceNodeIds.slice(0, 32),
    sourceNodeIdsTruncated: claim.sourceNodeIds.length > 32,
    claimType: claim.claimType,
    statement: claim.statement.slice(0, 4000),
    state: claim.state,
    semanticAuthority: claim.semanticAuthority,
    assessability: claim.assessability,
    nonOperativeReason: claim.nonOperativeReason?.slice(0, 1000) ?? null,
    sourceSupport: (claim.sourceSupport ?? []).slice(0, 32).map((support) => ({
      nodeId: support.nodeId,
      startOffset: support.startOffset,
      endOffset: support.endOffset,
      contentSha256: support.contentSha256,
    })),
    sourceSupportTruncated: (claim.sourceSupport?.length ?? 0) > 32,
  }));
  const includedClaimIds = new Set(claims.map((claim) => claim.claimId));
  const identities = Object.fromEntries(
    Object.entries(payload.identities)
      .filter(([claimId]) => includedClaimIds.has(claimId))
      .slice(0, DETAIL_LIST_LIMIT)
      .map(([claimId, value]) => [claimId, value.slice(0, 256)]),
  );
  const relations = payload.relations
    .slice(0, DETAIL_LIST_LIMIT)
    .map((relation) => ({
      relationId: relation.relationId,
      kind: relation.kind,
      fromClaimId: relation.fromClaimId,
      toClaimId: relation.toClaimId,
      referenceId: relation.referenceId,
    }));
  const referenceAccounting = payload.referenceAccounting
    .slice(0, DETAIL_LIST_LIMIT)
    .map((item) => ({
      referenceId: item.referenceId,
      material: item.material,
      relationIds: item.relationIds.slice(0, 100),
      relationIdsTruncated: item.relationIds.length > 100,
      nonMaterialReason: item.nonMaterialReason?.slice(0, 1000) ?? null,
    }));
  const directClaimIds = claims
    .filter((claim) => claim.sourceNodeIds.includes(row.sourceNodeId))
    .map((claim) => claim.claimId);
  const reason = row.reason?.slice(0, 1000) ?? null;
  return {
    preparationRunId: input.preparationRunId,
    inventoryRevision: input.inventoryRevision,
    legalSourceVersionId: input.legalSourceVersionId,
    materializationId: input.materializationId,
    sourceNodeId: row.sourceNodeId,
    documentId: row.node.documentId,
    nodeType: row.node.nodeType,
    parentNodeId: row.node.parentNodeId,
    structuralPath: row.structuralPath,
    ordinal: row.ordinal,
    label: row.node.label.slice(0, 512),
    title: row.node.title.slice(0, 512),
    ancestors: input.ancestors,
    review: {
      state: row.state,
      disposition: row.disposition,
      reason,
      reasonTruncated: (row.reason?.length ?? 0) > 1000,
      completedAt: row.completedAt?.toISOString() ?? null,
      claimCount: row.ownedClaimCount,
      claimIds: row.claimIds.slice(0, DETAIL_LIST_LIMIT),
      claimIdsTruncated: row.claimIds.length > DETAIL_LIST_LIMIT,
      referenceCount: row.referenceIds.length,
      referenceIds: row.referenceIds.slice(0, DETAIL_LIST_LIMIT),
      referenceIdsTruncated: row.referenceIds.length > DETAIL_LIST_LIMIT,
      blockedReferenceCount: row.blockedReferenceIds.length,
      blockedReferenceIds: row.blockedReferenceIds.slice(0, DETAIL_LIST_LIMIT),
      blockedReferenceIdsTruncated:
        row.blockedReferenceIds.length > DETAIL_LIST_LIMIT,
    },
    output: {
      availability:
        claims.length || relations.length || referenceAccounting.length
          ? SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE
          : SOURCE_UNIT_DETAIL_AVAILABILITY.EMPTY,
      claims,
      claimsTruncated: payload.claims.length > DETAIL_LIST_LIMIT,
      identities,
      identitiesTruncated:
        Object.keys(payload.identities).length > DETAIL_LIST_LIMIT,
      relations,
      relationsTruncated: payload.relations.length > DETAIL_LIST_LIMIT,
      referenceAccounting,
      referenceAccountingTruncated:
        payload.referenceAccounting.length > DETAIL_LIST_LIMIT,
    },
    provenance: {
      directClaimIds,
      requirementRuleMapping: input.requirementRuleMapping,
    },
  };
}

/**
 * Business purpose: Resolve only submitted Rule Set provenance that is pinned to this exact source-review snapshot.
 *
 * Business rules:
 * - A relationship is reportable only through persisted semantic-claim source, requirement binding, and assessment-rule link rows under the same Rule Set, materialization, and Legal Source Version.
 * - Missing submission or a graph pin mismatch is unavailable, never an empty inferred association.
 *
 * Execution flow:
 * 1. Confirm the submitted Rule Set and its semantic graph match the Preparation and frontier pins.
 * 2. Query only this source unit's persisted semantic claims and traverse canonical requirement and assessment-rule bindings.
 * 3. Deduplicate and sort identifiers for a stable bounded result.
 *
 * Failure cases:
 * - No submitted Rule Set or no exact semantic graph returns an explicit unavailable reason; database errors propagate.
 *
 * Side effects:
 * - Read-only bounded queries; no rules, assessments, or provenance are changed.
 */
async function loadRequirementRuleMapping(
  tx: Prisma.TransactionClient,
  ruleSet: {
    id: string;
    legalSourceVersionId: string;
    semanticGraph: {
      materializationId: string;
      legalSourceVersionId: string;
    } | null;
  } | null,
  materializationId: string,
  legalSourceVersionId: string,
  sourceNodeId: string,
  claimIds: string[],
) {
  if (!ruleSet)
    return {
      availability: SOURCE_UNIT_DETAIL_AVAILABILITY.UNAVAILABLE,
      unavailableReason:
        SOURCE_UNIT_DETAIL_MAPPING_REASONS.RULE_SET_NOT_SUBMITTED,
      associations: [],
      associationsTruncated: false,
    };
  if (
    ruleSet.legalSourceVersionId !== legalSourceVersionId ||
    !ruleSet.semanticGraph ||
    ruleSet.semanticGraph.legalSourceVersionId !== legalSourceVersionId ||
    ruleSet.semanticGraph.materializationId !== materializationId
  )
    return {
      availability: SOURCE_UNIT_DETAIL_AVAILABILITY.UNAVAILABLE,
      unavailableReason:
        SOURCE_UNIT_DETAIL_MAPPING_REASONS.PINNED_SEMANTIC_GRAPH_UNAVAILABLE,
      associations: [],
      associationsTruncated: false,
    };

  const rows = claimIds.length
    ? await tx.legalSemanticClaim.findMany({
        where: {
          ruleSetVersionId: ruleSet.id,
          materializationId,
          legalSourceVersionId,
          claimId: { in: claimIds },
          sources: { some: { sourceNodeId } },
        },
        select: {
          claimId: true,
          bindings: {
            select: {
              requirement: {
                select: {
                  legalRequirementId: true,
                  assessmentRuleLinks: {
                    select: {
                      assessmentRule: { select: { assessmentRuleId: true } },
                    },
                  },
                },
              },
            },
          },
        },
      })
    : [];
  const associationIndex = new Map<
    string,
    {
      claimId: string;
      legalRequirementId: string;
      assessmentRuleIds: Set<string>;
    }
  >();
  for (const row of rows) {
    for (const binding of row.bindings) {
      const key = `${row.claimId}:${binding.requirement.legalRequirementId}`;
      const association = associationIndex.get(key) ?? {
        claimId: row.claimId,
        legalRequirementId: binding.requirement.legalRequirementId,
        assessmentRuleIds: new Set<string>(),
      };
      for (const link of binding.requirement.assessmentRuleLinks)
        association.assessmentRuleIds.add(link.assessmentRule.assessmentRuleId);
      associationIndex.set(key, association);
    }
  }
  const associations = [...associationIndex.values()].map((association) => ({
    claimId: association.claimId,
    legalRequirementId: association.legalRequirementId,
    assessmentRuleIds: [...association.assessmentRuleIds].sort(),
  }));
  associations.sort(
    (left, right) =>
      left.claimId.localeCompare(right.claimId) ||
      left.legalRequirementId.localeCompare(right.legalRequirementId),
  );
  return {
    availability: SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE,
    unavailableReason: null,
    associations: associations.slice(0, DETAIL_LIST_LIMIT),
    associationsTruncated: associations.length > DETAIL_LIST_LIMIT,
  };
}

/**
 * Business purpose: Give equivalent Explorer filters one stable cursor identity.
 * Business rules:
 * - Empty optional filters are omitted and normalized search text is bound to each cursor.
 * Execution flow:
 * 1. Trim/case-fold search and trim document identity, then omit empty optional filters.
 * Failure cases:
 * - The request schema rejects malformed or overlong filter input before normalization.
 * Side effects:
 * - Pure transformation with no persistence or external effects.
 */
function normalizeFilters(request: PreparationSourceUnitsRequest) {
  const search = request.search?.trim().toLocaleLowerCase("vi");
  return {
    ...(request.state ? { state: request.state } : {}),
    ...(request.documentId ? { documentId: request.documentId.trim() } : {}),
    ...(search ? { search } : {}),
  };
}

/**
 * Business purpose: Prevent a client cursor from selecting arbitrary pagination positions or frontier identities.
 * Business rules:
 * - Only bounded base64url version-one cursors with the complete typed scope and keyset fields are accepted.
 * Execution flow:
 * 1. Validate encoded size/alphabet, decode JSON, and parse the payload against the strict cursor schema.
 * Failure cases:
 * - Any decoding or schema error becomes the canonical invalid-request problem.
 * Side effects:
 * - Pure validation with no persistence or external effects.
 */
function decodeCursor(cursor: string, correlationId: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(cursor)) throw new Error("invalid");
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    return cursorSchema.parse(decoded);
  } catch {
    throw problemException(
      COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
}

/**
 * Business purpose: Preserve the exact snapshot, filters and keyset position for the next Explorer page.
 * Business rules:
 * - The payload contains only fields validated from the request or read from canonical persistence.
 * Execution flow:
 * 1. Serialize the typed cursor and encode it as URL-safe base64 without padding.
 * Failure cases:
 * - Serialization errors propagate without changing stored state.
 * Side effects:
 * - Pure transformation with no persistence or external effects.
 */
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/**
 * Business purpose: Detect a cursor whose pinned review frontier changed between page requests.
 * Business rules:
 * - Materialization, revision and every canonical frontier fingerprint must match exactly.
 * Execution flow:
 * 1. Compare the cursor snapshot identity with the current persisted frontier identity.
 * Failure cases:
 * - A mismatch is returned to the caller for a typed stale-snapshot conflict.
 * Side effects:
 * - Pure comparison with no persistence or external effects.
 */
function cursorMatchesFrontier(
  cursor: Cursor,
  frontier: {
    materializationId: string;
    revision: number;
    fingerprint: string;
    stateFingerprint: string;
    stateAccumulator: string;
  },
) {
  return (
    cursor.materializationId === frontier.materializationId &&
    cursor.frontierRevision === frontier.revision &&
    cursor.fingerprint === frontier.fingerprint &&
    cursor.stateFingerprint === frontier.stateFingerprint &&
    cursor.stateAccumulator === frontier.stateAccumulator
  );
}

/**
 * Business purpose: Add bounded, contract-safe hierarchy context without changing review-unit granularity.
 * Business rules:
 * - Ancestors must belong to the pinned materialization/version and traversal stops after eight levels.
 * - The public projection uses sourceNodeId and excludes database traversal fields such as parentNodeId.
 * Execution flow:
 * 1. Resolve parent IDs in bounded batches, project canonical ancestor DTO fields, and order each chain root-to-parent.
 * Failure cases:
 * - Missing parents stop that unit's ancestry; database errors propagate to the read transaction.
 * Side effects:
 * - Performs only bounded reads within the caller's transaction.
 */
async function loadAncestors(
  tx: Prisma.TransactionClient,
  nodes: NodeProjection[],
  materializationId: string,
  legalSourceVersionId: string,
) {
  const result = new Map<string, AncestorProjection[]>();
  const pending = new Map<string, string | null>(
    nodes.map((node) => [node.nodeId, node.parentNodeId]),
  );
  for (let depth = 0; depth < 8; depth += 1) {
    const parentIds = [
      ...new Set(
        [...pending.values()].filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!parentIds.length) break;
    const parents = await tx.legalDocumentNode.findMany({
      where: {
        nodeId: { in: parentIds },
        materializationId,
        legalSourceVersionId,
      },
      select: {
        nodeId: true,
        nodeType: true,
        parentNodeId: true,
        structuralPath: true,
        ordinal: true,
        label: true,
        title: true,
      },
    });
    const byId = new Map(parents.map((node) => [node.nodeId, node]));
    for (const [sourceNodeId, parentId] of pending) {
      if (!parentId) continue;
      const parent = byId.get(parentId);
      if (!parent) {
        pending.set(sourceNodeId, null);
        continue;
      }
      result.set(sourceNodeId, [
        ...(result.get(sourceNodeId) ?? []),
        {
          sourceNodeId: parent.nodeId,
          nodeType: parent.nodeType,
          structuralPath: parent.structuralPath,
          ordinal: parent.ordinal,
          label: parent.label,
          title: parent.title,
        },
      ]);
      pending.set(sourceNodeId, parent.parentNodeId);
    }
  }
  for (const values of result.values()) values.reverse();
  return result;
}
