import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  preparationSourceUnitsResponseSchema,
  type PreparationSourceUnitsRequest,
  type PreparationSourceUnitsResponse,
} from "@lcsp/contracts/compliance-rule-set";
import { SOURCE_REVIEW_STATES } from "@lcsp/contracts/legal-source";
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
