import { Injectable, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_CATALOG_COMPLETENESS,
  PREPARATION_CATALOG_KINDS,
  PREPARATION_CATALOG_REFERENCE_STATES,
  PREPARATION_CATALOG_SOURCES,
  PREPARATION_CATALOG_UNAVAILABLE_REASONS,
  assessmentRuleSchema,
  legalRequirementSchema,
  preparationGeneratedCatalogResponseSchema,
  ruleSetPreparationAuthoringDraftSchema,
  type PreparationGeneratedCatalogRequest,
  type PreparationGeneratedCatalogResponse,
} from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { contractChunkIds } from "./compliance-rule-set.mappers.js";

const catalogCursorSchema = z.strictObject({
  version: z.literal(1),
  preparationRunId: z.string().uuid(),
  inventoryRevision: z.number().int().positive(),
  legalSourceVersionId: z.string().uuid(),
  materializationId: z.string().min(1).max(256),
  source: z.enum(PREPARATION_CATALOG_SOURCES),
  kind: z.enum(PREPARATION_CATALOG_KINDS),
  search: z.string().max(128).nullable(),
  draftVersion: z.number().int().positive().nullable(),
  ruleSetVersionId: z.string().uuid().nullable(),
  lastId: z.string().min(1).max(128),
});
type CatalogCursor = z.infer<typeof catalogCursorSchema>;

const CATALOG_ERROR = COMPLIANCE_RULE_SET_ERROR_CODES;

@Injectable()
export class PreparationGeneratedCatalogReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Read one bounded catalog page for the exact Preparation source snapshot.
   *
   * Business rules:
   * - Admin authorization is enforced by the controller; this service binds all data to the run, requested inventory revision, source version, and frontier materialization.
   * - An existing submitted Rule Set is authoritative and never falls back to a draft; draft candidates are read only from the exact revision and validated before projection.
   * - Search and pagination narrow the page while total remains the canonical count for the selected collection.
   *
   * Execution flow:
   * 1. Decode the opaque cursor and open a repeatable-read transaction.
   * 2. Load the run and exact frontier, then choose its owned submitted Rule Set or exact-revision authoring draft.
   * 3. Validate and project bounded canonical entities, apply search and keyset pagination, and bind the next cursor to every selected identity.
   * 4. Validate the response contract before returning it.
   *
   * Failure cases:
   * - Missing run returns the typed not-found problem; absent frontier or stale pins return a conflict.
   * - Malformed cursors return a typed request problem; changed draft/source identities reject continuation instead of restarting.
   * - Invalid persisted draft or submitted structures return a typed integrity problem and are never represented as empty data.
   *
   * Side effects:
   * - Read-only repeatable-read database transaction; no authoring, Rule Set, graph, or worker state is modified.
   */
  async list(
    preparationRunId: string,
    request: PreparationGeneratedCatalogRequest,
    correlationId: string,
  ): Promise<PreparationGeneratedCatalogResponse> {
    const search = request.search?.trim().toLocaleLowerCase("en-US") || null;
    const cursor = request.cursor
      ? decodeCatalogCursor(request.cursor, correlationId)
      : null;
    if (
      cursor &&
      (cursor.preparationRunId !== preparationRunId ||
        cursor.inventoryRevision !== request.inventoryRevision ||
        cursor.kind !== request.kind ||
        cursor.search !== search)
    ) {
      throw problemException(
        CATALOG_ERROR.catalogRequestInvalid,
        correlationId,
        {
          status: HttpStatus.BAD_REQUEST,
        },
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const run = await tx.ruleSetPreparationRun.findUnique({
          where: { id: preparationRunId },
          select: {
            id: true,
            legalSourceVersionId: true,
            claimInventoryRevision: true,
            ruleSet: {
              select: {
                id: true,
                preparationRunId: true,
                legalSourceVersionId: true,
                semanticGraph: {
                  select: {
                    legalSourceVersionId: true,
                    materializationId: true,
                  },
                },
              },
            },
          },
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
          select: {
            inventoryRevision: true,
            legalSourceVersionId: true,
            materializationId: true,
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

        if (run.ruleSet) {
          if (
            run.ruleSet.preparationRunId !== run.id ||
            run.ruleSet.legalSourceVersionId !== run.legalSourceVersionId ||
            run.claimInventoryRevision !== request.inventoryRevision ||
            (run.ruleSet.semanticGraph !== null &&
              (run.ruleSet.semanticGraph.legalSourceVersionId !==
                run.legalSourceVersionId ||
                run.ruleSet.semanticGraph.materializationId !==
                  frontier.materializationId))
          ) {
            throw problemException(
              COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
              correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }
          return this.readSubmitted(tx, {
            preparationRunId,
            request,
            correlationId,
            search,
            cursor,
            legalSourceVersionId: run.legalSourceVersionId,
            materializationId: frontier.materializationId,
            ruleSetVersionId: run.ruleSet.id,
          });
        }

        const draft = await tx.ruleSetPreparationAuthoringDraft.findUnique({
          where: {
            preparationRunId_revision: {
              preparationRunId,
              revision: request.inventoryRevision,
            },
          },
          select: { draftVersion: true, draft: true },
        });
        if (!draft) {
          if (cursor) {
            throw problemException(
              CATALOG_ERROR.catalogCursorStale,
              correlationId,
              {
                status: HttpStatus.CONFLICT,
              },
            );
          }
          return preparationGeneratedCatalogResponseSchema.parse({
            preparationRunId,
            inventoryRevision: frontier.inventoryRevision,
            legalSourceVersionId: run.legalSourceVersionId,
            materializationId: frontier.materializationId,
            source: PREPARATION_CATALOG_SOURCES.UNAVAILABLE,
            completeness: PREPARATION_CATALOG_COMPLETENESS.UNAVAILABLE,
            draftVersion: null,
            ruleSetVersionId: null,
            lifecycleState: null,
            unavailableReason:
              PREPARATION_CATALOG_UNAVAILABLE_REASONS.NO_DRAFT_OR_SUBMITTED_RULE_SET,
            kind: request.kind,
            total: 0,
            filteredTotal: 0,
            items: [],
            hasMore: false,
            nextCursor: null,
          });
        }

        if (
          cursor &&
          (cursor.source !== PREPARATION_CATALOG_SOURCES.DRAFT ||
            cursor.draftVersion !== draft.draftVersion ||
            cursor.ruleSetVersionId !== null ||
            cursor.materializationId !== frontier.materializationId ||
            cursor.legalSourceVersionId !== run.legalSourceVersionId)
        ) {
          throw problemException(
            CATALOG_ERROR.catalogCursorStale,
            correlationId,
            {
              status: HttpStatus.CONFLICT,
            },
          );
        }

        const parsedDraft = ruleSetPreparationAuthoringDraftSchema.safeParse(
          draft.draft,
        );
        if (!parsedDraft.success) {
          throw problemException(
            CATALOG_ERROR.catalogPersistedDataInvalid,
            correlationId,
            { status: HttpStatus.INTERNAL_SERVER_ERROR },
          );
        }
        const draftItems =
          request.kind === PREPARATION_CATALOG_KINDS.REQUIREMENT
            ? Object.values(parsedDraft.data.legalRequirements).map((item) =>
                projectDraftRequirement(item),
              )
            : Object.values(parsedDraft.data.assessmentRules).map((item) =>
                projectDraftAssessmentRule(item),
              );
        const rows = draftItems
          .filter((item) => matchesDraftSearch(item, search))
          .sort((left, right) =>
            left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
          );
        const total =
          request.kind === PREPARATION_CATALOG_KINDS.REQUIREMENT
            ? Object.keys(parsedDraft.data.legalRequirements).length
            : Object.keys(parsedDraft.data.assessmentRules).length;
        const filteredTotal = rows.length;
        const afterCursor = cursor
          ? rows.filter((item) => item.id > cursor.lastId)
          : rows;
        const page = afterCursor.slice(0, request.limit);
        const hasMore = afterCursor.length > page.length;
        const last = page.at(-1);
        const nextCursor =
          hasMore && last
            ? encodeCatalogCursor({
                version: 1,
                preparationRunId,
                inventoryRevision: frontier.inventoryRevision,
                legalSourceVersionId: run.legalSourceVersionId,
                materializationId: frontier.materializationId,
                source: PREPARATION_CATALOG_SOURCES.DRAFT,
                kind: request.kind,
                search,
                draftVersion: draft.draftVersion,
                ruleSetVersionId: null,
                lastId: last.id,
              })
            : null;
        return preparationGeneratedCatalogResponseSchema.parse({
          preparationRunId,
          inventoryRevision: frontier.inventoryRevision,
          legalSourceVersionId: run.legalSourceVersionId,
          materializationId: frontier.materializationId,
          source: PREPARATION_CATALOG_SOURCES.DRAFT,
          completeness: PREPARATION_CATALOG_COMPLETENESS.PARTIAL,
          draftVersion: draft.draftVersion,
          ruleSetVersionId: null,
          lifecycleState: null,
          unavailableReason: null,
          kind: request.kind,
          total,
          filteredTotal,
          items: page,
          hasMore,
          nextCursor,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Business purpose: Page one canonical persisted collection from the Rule Set owned by the selected Preparation.
   *
   * Business rules:
   * - The submitted version must match the exact run and Legal Source Version; canonical database rows and relation tables override denormalized JSON identifiers.
   * - Source references are exposed only from persisted provenance or source chunks belonging to the pinned Legal Source Version.
   *
   * Execution flow:
   * 1. Count the full collection and the normalized search result.
   * 2. Fetch a stable page by canonical entity ID and load only its permitted relation data.
   * 3. Project and validate each item, then issue a cursor bound to the Rule Set and source snapshot.
   *
   * Failure cases:
   * - A changed or mismatched submission rejects stale cursors; malformed persisted canonical data returns a typed integrity problem.
   *
   * Side effects:
   * - Read-only database queries inside the caller's repeatable-read transaction.
   */
  private async readSubmitted(
    tx: Prisma.TransactionClient,
    input: {
      preparationRunId: string;
      request: PreparationGeneratedCatalogRequest;
      correlationId: string;
      search: string | null;
      cursor: CatalogCursor | null;
      legalSourceVersionId: string;
      materializationId: string;
      ruleSetVersionId: string;
    },
  ): Promise<PreparationGeneratedCatalogResponse> {
    const { request, search } = input;
    const requirementKind =
      request.kind === PREPARATION_CATALOG_KINDS.REQUIREMENT;
    const cursor = input.cursor;
    if (
      cursor &&
      (cursor.source !== PREPARATION_CATALOG_SOURCES.SUBMITTED ||
        cursor.draftVersion !== null ||
        cursor.ruleSetVersionId !== input.ruleSetVersionId ||
        cursor.materializationId !== input.materializationId ||
        cursor.legalSourceVersionId !== input.legalSourceVersionId)
    ) {
      throw problemException(
        CATALOG_ERROR.catalogCursorStale,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
        },
      );
    }

    if (requirementKind) {
      const filterWhere: Prisma.LegalRequirementWhereInput = {
        ruleSetVersionId: input.ruleSetVersionId,
        ...(search
          ? {
              OR: [
                {
                  legalRequirementId: { contains: search, mode: "insensitive" },
                },
                { title: { contains: search, mode: "insensitive" } },
                { proposition: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const where: Prisma.LegalRequirementWhereInput = {
        ...filterWhere,
        ...(cursor ? { legalRequirementId: { gt: cursor.lastId } } : {}),
      };
      const [total, filteredTotal, rows] = await Promise.all([
        tx.legalRequirement.count({
          where: { ruleSetVersionId: input.ruleSetVersionId },
        }),
        tx.legalRequirement.count({ where: filterWhere }),
        tx.legalRequirement.findMany({
          where,
          orderBy: { legalRequirementId: "asc" },
          take: request.limit + 1,
          select: {
            id: true,
            legalRequirementId: true,
            ordinal: true,
            applicabilityMode: true,
            title: true,
            proposition: true,
            operativePropositions: true,
            semanticContext: true,
            applicabilityConditions: true,
            qualifiers: true,
            exceptions: true,
            nonRepositoryDuty: true,
            coverageState: true,
            nonAssessableReason: true,
            claimBindings: {
              select: { claimId: true, role: true, index: true },
            },
            provenance: {
              orderBy: { ordinal: "asc" },
              select: { documentId: true, locator: true, contentSha256: true },
            },
          },
        }),
      ]);
      const rowPage = rows.slice(0, request.limit);
      const items = rowPage.map((row) => {
        const coverageState = enumMember(
          LEGAL_REQUIREMENT_COVERAGE_STATES,
          row.coverageState,
        );
        if (!coverageState) this.invalidPersistedData(input.correlationId);
        const data = legalRequirementSchema.safeParse({
          legalRequirementId: row.legalRequirementId,
          ...(row.applicabilityMode
            ? { applicabilityMode: row.applicabilityMode }
            : {}),
          title: row.title,
          proposition: row.proposition,
          ...(row.operativePropositions !== null
            ? { operativePropositions: row.operativePropositions }
            : {}),
          ...(row.semanticContext !== null
            ? { semanticContext: row.semanticContext }
            : {}),
          applicabilityConditions: row.applicabilityConditions,
          qualifiers: row.qualifiers,
          exceptions: row.exceptions,
          nonRepositoryDuty: row.nonRepositoryDuty,
          coverage: {
            state: coverageState,
            nonAssessableReason: row.nonAssessableReason,
          },
          claimBindings: row.claimBindings.map((binding) => ({
            claimId: binding.claimId,
            role: binding.role,
            index: binding.index,
          })),
          sourceRefs: row.provenance.map((reference) => ({
            documentId: reference.documentId,
            locator: reference.locator,
            contentSha256: reference.contentSha256,
          })),
        });
        if (!data.success) this.invalidPersistedData(input.correlationId);
        return {
          id: row.legalRequirementId,
          ordinal: row.ordinal,
          data: {
            legalRequirementId: data.data.legalRequirementId,
            title: data.data.title,
            proposition: data.data.proposition,
            operativePropositions: data.data.operativePropositions ?? null,
            applicabilityConditions: data.data.applicabilityConditions,
            qualifiers: data.data.qualifiers,
            exceptions: data.data.exceptions,
            nonRepositoryDuty: data.data.nonRepositoryDuty,
            coverage: data.data.coverage,
            claimBindings: data.data.claimBindings ?? [],
            claimBindingsState: data.data.claimBindings?.length
              ? PREPARATION_CATALOG_REFERENCE_STATES.SUBMITTED_VERIFIED
              : PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
            sourceReferences: data.data.sourceRefs,
            sourceReferencesState: data.data.sourceRefs.length
              ? PREPARATION_CATALOG_REFERENCE_STATES.SUBMITTED_VERIFIED
              : PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
          },
        };
      });
      const lastId = rowPage.at(-1)?.legalRequirementId;
      const hasMore = rows.length > request.limit;
      return preparationGeneratedCatalogResponseSchema.parse({
        ...this.responseIdentity(input),
        kind: request.kind,
        total,
        filteredTotal,
        items,
        hasMore,
        nextCursor:
          hasMore && lastId ? this.encodeNextCursor(input, lastId) : null,
      });
    }

    const ruleWhere: Prisma.AssessmentRuleWhereInput = {
      ruleSetVersionId: input.ruleSetVersionId,
      ...(search
        ? {
            OR: [
              { assessmentRuleId: { contains: search, mode: "insensitive" } },
              { concept: { contains: search, mode: "insensitive" } },
              { legalIntent: { contains: search, mode: "insensitive" } },
              {
                applicabilityGuidance: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
      ...(cursor ? { assessmentRuleId: { gt: cursor.lastId } } : {}),
    };
    const [total, filteredTotal, rows] = await Promise.all([
      tx.assessmentRule.count({
        where: { ruleSetVersionId: input.ruleSetVersionId },
      }),
      tx.assessmentRule.count({ where: ruleWhere }),
      tx.assessmentRule.findMany({
        where: ruleWhere,
        orderBy: { assessmentRuleId: "asc" },
        take: request.limit + 1,
        select: {
          assessmentRuleId: true,
          ordinal: true,
          concept: true,
          legalIntent: true,
          applicabilityGuidance: true,
          criteria: true,
          contract: true,
          legalRequirementLinks: {
            select: {
              legalRequirement: { select: { legalRequirementId: true } },
            },
          },
        },
      }),
    ]);
    const rowPage = rows.slice(0, request.limit);
    const chunkIds = [
      ...new Set(rowPage.flatMap((row) => contractChunkIds(row.contract))),
    ];
    const chunks = chunkIds.length
      ? await tx.legalDocumentChunk.findMany({
          where: {
            id: { in: chunkIds },
            legalSourceVersionId: input.legalSourceVersionId,
          },
          select: {
            id: true,
            documentId: true,
            locator: true,
            contentSha256: true,
          },
        })
      : [];
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    if (chunks.length !== chunkIds.length)
      this.invalidPersistedData(input.correlationId);
    const items = rowPage.map((row) => {
      const references = contractChunkIds(row.contract).flatMap((id) => {
        const chunk = chunkById.get(id);
        return chunk
          ? [
              {
                documentId: chunk.documentId,
                locator: chunk.locator,
                contentSha256: chunk.contentSha256,
              },
            ]
          : [];
      });
      const rawContract = row.contract as Record<string, unknown>;
      const { sourceChunkIds: _sourceChunkIds, ...safeContract } = rawContract;
      void _sourceChunkIds;
      const requirementIds = row.legalRequirementLinks
        .map((link) => link.legalRequirement.legalRequirementId)
        .sort();
      const parsed = assessmentRuleSchema.safeParse({
        ...safeContract,
        assessmentRuleId: row.assessmentRuleId,
        legalRequirementIds: requirementIds,
        concept: row.concept,
        legalIntent: row.legalIntent,
        applicabilityGuidance: row.applicabilityGuidance,
        criteria: row.criteria,
        sourceRefs: references,
      });
      if (!parsed.success) this.invalidPersistedData(input.correlationId);
      return {
        id: row.assessmentRuleId,
        ordinal: row.ordinal,
        data: {
          assessmentRuleId: parsed.data.assessmentRuleId,
          concept: parsed.data.concept,
          legalIntent: parsed.data.legalIntent,
          applicabilityGuidance: parsed.data.applicabilityGuidance,
          legalRequirementIds: requirementIds,
          criteria: parsed.data.criteria.map((criterion) => ({
            criterionId: criterion.criterionId,
            legalRequirementIds: criterion.legalRequirementIds ?? [],
            statement: criterion.statement,
            investigationFocus: criterion.investigationFocus ?? null,
          })),
          investigationGoals: parsed.data.investigationGoals,
          startingNodeTypes: parsed.data.startingNodeTypes,
          targetNodeTypes: parsed.data.targetNodeTypes,
          edgeStrategies: parsed.data.edgeStrategies,
          keywords: parsed.data.keywords,
          requiredEvidence: parsed.data.requiredEvidence,
          supportingEvidence: parsed.data.supportingEvidence,
          negativeEvidence: parsed.data.negativeEvidence,
          unresolvedConditions: parsed.data.unresolvedConditions,
          sourceReferences: references,
          sourceReferencesState: references.length
            ? PREPARATION_CATALOG_REFERENCE_STATES.SUBMITTED_VERIFIED
            : PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
        },
      };
    });
    const lastId = rowPage.at(-1)?.assessmentRuleId;
    const hasMore = rows.length > request.limit;
    return preparationGeneratedCatalogResponseSchema.parse({
      ...this.responseIdentity(input),
      kind: request.kind,
      total,
      filteredTotal,
      items,
      hasMore,
      nextCursor:
        hasMore && lastId ? this.encodeNextCursor(input, lastId) : null,
    });
  }

  /**
   * Business purpose: Attach the verified submitted-source identity shared by every page of a canonical catalog.
   *
   * Business rules:
   * - The caller supplies only a Rule Set already matched to the selected Preparation run and source snapshot.
   *
   * Execution flow:
   * 1. Copy the validated run, inventory, source version, materialization, and submitted version identities.
   * 2. Mark lifecycle detail unavailable when this projection has not independently mapped its persistence enum.
   *
   * Failure cases:
   * - The enclosing response schema rejects malformed identifiers or missing required identity fields.
   *
   * Side effects:
   * - Pure DTO construction; no database state is changed.
   */
  private responseIdentity(input: {
    preparationRunId: string;
    request: PreparationGeneratedCatalogRequest;
    legalSourceVersionId: string;
    materializationId: string;
    ruleSetVersionId: string;
  }) {
    return {
      preparationRunId: input.preparationRunId,
      inventoryRevision: input.request.inventoryRevision,
      legalSourceVersionId: input.legalSourceVersionId,
      materializationId: input.materializationId,
      source: PREPARATION_CATALOG_SOURCES.SUBMITTED,
      completeness: PREPARATION_CATALOG_COMPLETENESS.COMPLETE,
      draftVersion: null,
      ruleSetVersionId: input.ruleSetVersionId,
      lifecycleState: null,
      unavailableReason: null,
    };
  }

  /**
   * Business purpose: Bind the next submitted-catalog page to the exact canonical Rule Set and query scope.
   *
   * Business rules:
   * - The opaque cursor preserves the selected run, inventory revision, source version, materialization, Rule Set, kind, and normalized search.
   *
   * Execution flow:
   * 1. Add the final canonical entity identifier as the keyset boundary.
   * 2. Encode the complete cursor contract for the next read.
   *
   * Failure cases:
   * - Cursor contract validation fails before any continuation can be accepted.
   *
   * Side effects:
   * - Pure encoding; no persistence or external state is changed.
   */
  private encodeNextCursor(
    input: {
      preparationRunId: string;
      request: PreparationGeneratedCatalogRequest;
      search: string | null;
      legalSourceVersionId: string;
      materializationId: string;
      ruleSetVersionId: string;
    },
    lastId: string,
  ) {
    return encodeCatalogCursor({
      version: 1,
      preparationRunId: input.preparationRunId,
      inventoryRevision: input.request.inventoryRevision,
      legalSourceVersionId: input.legalSourceVersionId,
      materializationId: input.materializationId,
      source: PREPARATION_CATALOG_SOURCES.SUBMITTED,
      kind: input.request.kind,
      search: input.search,
      draftVersion: null,
      ruleSetVersionId: input.ruleSetVersionId,
      lastId,
    });
  }

  /**
   * Business purpose: Refuse to present malformed persisted catalog data as valid business output.
   *
   * Business rules:
   * - Persisted draft or canonical Rule Set records that fail their shared projection contracts are integrity failures, not empty collections.
   *
   * Execution flow:
   * 1. Create the typed server-side catalog integrity problem with the current correlation identity.
   *
   * Failure cases:
   * - Always throws the shared 500 problem response; callers do not return partial fabricated data.
   *
   * Side effects:
   * - Raises an application error; no database state is changed.
   */
  private invalidPersistedData(correlationId: string): never {
    throw problemException(
      CATALOG_ERROR.catalogPersistedDataInvalid,
      correlationId,
      {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      },
    );
  }
}

/**
 * Business purpose: Project one validated authoring Requirement into the bounded draft catalog DTO.
 *
 * Business rules:
 * - Missing optional draft propositions or claim bindings remain explicitly unavailable or not recorded; no accepted status is inferred.
 *
 * Execution flow:
 * 1. Copy the persisted Requirement fields and source references from the validated draft.
 * 2. Mark references and bindings as draft-declared only when identifiers were persisted.
 *
 * Failure cases:
 * - Invalid values are rejected by the draft schema before projection and by the response schema afterward.
 *
 * Side effects:
 * - Pure bounded projection; no persistence is changed.
 */
function projectDraftRequirement(row: z.infer<typeof legalRequirementSchema>) {
  return {
    id: row.legalRequirementId,
    ordinal: null,
    data: {
      legalRequirementId: row.legalRequirementId,
      title: row.title,
      proposition: row.proposition,
      operativePropositions: row.operativePropositions ?? null,
      applicabilityConditions: row.applicabilityConditions,
      qualifiers: row.qualifiers,
      exceptions: row.exceptions,
      nonRepositoryDuty: row.nonRepositoryDuty,
      coverage: row.coverage,
      claimBindings: row.claimBindings ?? [],
      claimBindingsState: row.claimBindings?.length
        ? PREPARATION_CATALOG_REFERENCE_STATES.DRAFT_DECLARED
        : PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
      sourceReferences: row.sourceRefs,
      sourceReferencesState: row.sourceRefs.length
        ? PREPARATION_CATALOG_REFERENCE_STATES.DRAFT_DECLARED
        : PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
    },
  };
}

/**
 * Business purpose: Project one validated authoring Assessment Rule without supplying fields derived only at submission.
 *
 * Business rules:
 * - Optional legal intent, guidance, criterion statements, and unresolved conditions remain null when the draft omitted them.
 *
 * Execution flow:
 * 1. Preserve persisted identifiers, authoring fields, and declared Requirement links.
 * 2. Mark only persisted source references as draft-declared.
 *
 * Failure cases:
 * - Invalid draft shape is rejected before this helper and invalid output is rejected by the response contract.
 *
 * Side effects:
 * - Pure DTO projection; no persistence is changed.
 */
function projectDraftAssessmentRule(
  row: z.infer<
    typeof ruleSetPreparationAuthoringDraftSchema
  >["assessmentRules"][string],
) {
  return {
    id: row.assessmentRuleId,
    ordinal: null,
    data: {
      assessmentRuleId: row.assessmentRuleId,
      concept: row.concept,
      legalIntent: row.legalIntent ?? null,
      applicabilityGuidance: row.applicabilityGuidance ?? null,
      legalRequirementIds: row.legalRequirementIds,
      criteria: row.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        legalRequirementIds: criterion.legalRequirementIds ?? [],
        statement: criterion.statement ?? null,
        investigationFocus: criterion.investigationFocus ?? null,
      })),
      investigationGoals: row.investigationGoals,
      startingNodeTypes: row.startingNodeTypes,
      targetNodeTypes: row.targetNodeTypes,
      edgeStrategies: row.edgeStrategies,
      keywords: row.keywords,
      requiredEvidence: row.requiredEvidence,
      supportingEvidence: row.supportingEvidence,
      negativeEvidence: row.negativeEvidence,
      unresolvedConditions: row.unresolvedConditions ?? null,
      sourceReferences: row.sourceRefs,
      sourceReferencesState: row.sourceRefs.length
        ? PREPARATION_CATALOG_REFERENCE_STATES.DRAFT_DECLARED
        : PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
    },
  };
}

/**
 * Business purpose: Apply the bounded catalog search to a validated draft item.
 *
 * Business rules:
 * - Search affects only matching items and never changes the canonical collection total.
 *
 * Execution flow:
 * 1. Treat absent normalized search as a match.
 * 2. Compare normalized search text against the item's persisted projected fields.
 *
 * Failure cases:
 * - A serialization failure propagates rather than fabricating a match.
 *
 * Side effects:
 * - Pure in-memory predicate; no database state is changed.
 */
function matchesDraftSearch(item: unknown, search: string | null) {
  if (!search) return true;
  return JSON.stringify(item).toLocaleLowerCase("en-US").includes(search);
}

/**
 * Business purpose: Map a persisted bounded value only when it matches a published contract value.
 *
 * Business rules:
 * - A persisted value must exactly equal a published contract member so enum mismatches cannot be disguised as valid API data.
 *
 * Execution flow:
 * 1. Find an exact member in the contract value set.
 * 2. Return null when no exact mapping exists so the caller can reject or expose unavailable data.
 *
 * Failure cases:
 * - A value outside the published set returns null so callers can reject or explicitly mark the data unavailable.
 *
 * Side effects:
 * - Pure value mapping; no persistence or external state changes.
 */
function enumMember<T extends Record<string, string>>(
  values: T,
  value: string,
): T[keyof T] | null {
  return (
    (Object.values(values).find((candidate) => candidate === value) as
      T[keyof T] | undefined) ?? null
  );
}

/**
 * Business purpose: Encode a complete catalog continuation identity for the next bounded page.
 *
 * Business rules:
 * - The cursor contains only validated scope and the last stable entity identity.
 *
 * Execution flow:
 * 1. Serialize the validated cursor object.
 * 2. Encode it as base64url for transport as an opaque query value.
 *
 * Failure cases:
 * - Serialization errors propagate and no cursor is issued.
 *
 * Side effects:
 * - Pure encoding; no database state is changed.
 */
function encodeCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Business purpose: Validate and recover a client-supplied catalog continuation scope.
 *
 * Business rules:
 * - Only the exact cursor shape is accepted; malformed data is never treated as a first-page request.
 *
 * Execution flow:
 * 1. Decode base64url JSON and validate every identity, filter, version, and keyset field.
 * 2. Return the typed cursor only after strict schema validation.
 *
 * Failure cases:
 * - Invalid encoding or payload returns the typed catalog request problem.
 *
 * Side effects:
 * - Pure decoding; no database state is changed.
 */
function decodeCatalogCursor(
  value: string,
  correlationId: string,
): CatalogCursor {
  try {
    const parsed = catalogCursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // The same typed request problem is returned for malformed base64 and invalid cursor JSON.
  }
  throw problemException(CATALOG_ERROR.catalogRequestInvalid, correlationId, {
    status: HttpStatus.BAD_REQUEST,
  });
}
