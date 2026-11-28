import { Injectable } from "@nestjs/common";
import {
  Prisma,
  AgentExecutionState,
  LegalSourceLifecycleStatus,
  LegalRetrievalIndexStatus,
  LegalEffectStatus,
} from "@prisma/client";
import { z } from "zod";
import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_CATALOG_EVENTS as EVENTS,
  LEGAL_RULE_PREPARATION_STATES as S,
  LEGAL_RULE_INELIGIBILITY_REASONS as R,
  LEGAL_RULE_SELECTION_MODES as MODES,
  LEGAL_RULE_LIMITS,
  LEGAL_RULE_SOURCE_PROVISION_LEVELS,
  LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS,
  legalRuleCitationSchema,
  legalRuleListItemSchema,
  preparationRuleInputSchema,
  preparationRuleOutputSchema,
  type LegalRuleWrite,
  type LegalRuleList,
  type LegalRuleSelection,
  type PreparationRuleInput,
  type LegalRuleSourceProvision,
  type LegalRuleSourceProvisionImport,
  type LegalRuleSourceProvisionLimitation,
  type LegalRuleSourceProvisionQuery,
} from "@lcsp/contracts/legal-rule-catalog";
import { AUDIT_RESOURCE_TYPES, AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { RULE_SET_PREPARATION_UNRESOLVED_STATES } from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { LegalSourceAuthorityService } from "../../../legal-source/application/services/legal-source-authority.service.js";
import { LegalDocumentGraphService } from "../../../legal-source/application/services/legal-document-graph.service.js";
import { attachLegalRuleReferenceContext } from "./legal-rule-reference-context.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../assessment/domain/domain-ids.js";

import {
  composeLegalSourceProvisions,
  type SourceProvisionChunk,
} from "../../domain/legal-source-provision-composer.js";
import {
  catalogFailure,
  isEligibleLegalChunkStatus,
  preparationInputFingerprint,
  type CatalogClient,
} from "./legal-rule-catalog-shared.js";

export {
  composeLegalSourceProvisions,
  catalogFailure,
  isEligibleLegalChunkStatus,
  preparationInputFingerprint,
  type SourceProvisionChunk,
  type CatalogClient,
};

@Injectable()
export class LegalRuleCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriterService,
    // The versioned graph owns reference resolution for the picker.
    private readonly documentGraph: LegalDocumentGraphService,
    private readonly authority: LegalSourceAuthorityService = new LegalSourceAuthorityService(),
  ) {}

  /**
   * Business purpose: Browse editable development catalogs without inventing approved status.
   * Business rules:
   * - Admin authorization belongs to the HTTP boundary; catalog rows are human supplied.
   * Execution flow:
   * 1. Read the newest catalog identities and their source pins.
   * Failure cases:
   * - Database failures propagate; no fallback catalog is generated.
   * Side effects:
   * - Reads catalog metadata only, without changing any catalog or run state.
   */
  async catalogs() {
    return this.prisma.legalRuleCatalogVersion.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /**
   * Business purpose: Resolve one complete persisted document into eligible hierarchical source provisions.
   * Business rules:
   * - Only ACTIVE or SUPERSEDED source versions with a VALID retrieval index are available to the LegalRule Catalog.
   * - The document and all its chunks are loaded from the requested pinned version; the browser page never supplies ancestor content.
   * Execution flow:
   * 1. Validate source lifecycle and retrieval-index authority.
   * 2. Resolve the exact document and all stored chunks.
   * 3. Compose Article–Clause–Point leaves from persisted wording and hierarchy metadata.
   * Failure cases:
   * - Missing versions or documents return NOT_FOUND; unavailable sources or indexes return INELIGIBLE.
   * Side effects:
   * - Reads immutable source rows only and creates no catalog or LegalRule.
   */
  private async sourceProvisionProjection(
    sourceVersionId: string,
    documentId: string,
    cid: string,
  ) {
    const source = await this.prisma.legalSourceVersion.findUnique({
      where: { id: sourceVersionId },
      include: {
        retrievalIndexes: {
          where: {
            status: LegalRetrievalIndexStatus.VALID,
            validatedAt: { not: null },
            validationManifestRef: { not: null },
          },
          take: 1,
        },
      },
    });
    if (!source) catalogFailure(E.NOT_FOUND, cid, 404);
    if (
      (source.status !== LegalSourceLifecycleStatus.ACTIVE &&
        source.status !== LegalSourceLifecycleStatus.SUPERSEDED) ||
      !source.retrievalIndexes.length
    )
      catalogFailure(E.INELIGIBLE, cid);

    const document = await this.prisma.legalSourceDocument.findUnique({
      where: {
        legalSourceVersionId_documentId: {
          legalSourceVersionId: source.id,
          documentId,
        },
      },
      select: { id: true, documentId: true, title: true },
    });
    if (!document) catalogFailure(E.NOT_FOUND, cid, 404);

    const chunks = await this.prisma.legalDocumentChunk.findMany({
      where: {
        legalSourceVersionId: source.id,
        documentId: document.documentId,
      },
      orderBy: { locator: "asc" },
      select: {
        id: true,
        documentId: true,
        locator: true,
        content: true,
        contentSha256: true,
        hierarchy: true,
        legalEffectStatus: true,
      },
    });
    // Keep exact persisted locator-to-chunk identity available for graph evidence.
    return {
      ...composeLegalSourceProvisions({
        sourceVersionId: source.id,
        documentId: document.documentId,
        documentTitle: document.title,
        chunks,
      }),
      chunkIdsByLocator: new Map(
        chunks.map(({ locator, id }) => [locator, id]),
      ),
    };
  }

  /**
   * Business purpose: Browse server-composed legal provision leaves for the source picker.
   * Business rules:
   * - Pagination is applied after the complete document hierarchy has been resolved, so parent context is independent of the current page.
   * - Unclassified, structurally incomplete and non-EFFECTIVE text is never returned as an importable provision.
   * Execution flow:
   * 1. Load and compose the requested pinned source document.
   * 2. Select a bounded page and attach direct reference previews using the pinned source graph.
   * 3. Return the enriched page and all explicit classification limitations.
   * Failure cases:
   * - Missing or ineligible source material is rejected by the shared projection authority.
   * Side effects:
   * - May materialize a missing derived graph; no persisted chunk or LegalRule is changed.
   */
  async sourceProvisions(query: LegalRuleSourceProvisionQuery, cid: string) {
    const projection = await this.sourceProvisionProjection(
      query.sourceVersionId,
      query.documentId,
      cid,
    );
    const start = (query.page - 1) * query.pageSize;
    const items = projection.items.slice(start, start + query.pageSize);
    // Only map chunk IDs from the requested page to the reused source graph.
    const chunkIds = new Set(
      items.flatMap((item) =>
        item.citationLocatorRefs.flatMap(({ locator }) => {
          const id = projection.chunkIdsByLocator.get(locator);
          return id ? [id] : [];
        }),
      ),
    );
    const graph = items.length
      ? await this.documentGraph.referenceEvidence(
          query.sourceVersionId,
          query.documentId,
          [...chunkIds],
        )
      : null;
    return {
      sourceVersionId: query.sourceVersionId,
      documentId: query.documentId,
      total: projection.items.length,
      page: query.page,
      pageSize: query.pageSize,
      items: graph
        ? attachLegalRuleReferenceContext(
            items,
            projection.chunkIdsByLocator,
            graph,
          )
        : items,
      limitations: projection.limitations,
    };
  }

  /**
   * Business purpose: Import one authoritative source leaf as a LegalRule with its deterministic hierarchical description.
   * Business rules:
   * - The catalog's exact source-version pin is authoritative; clients cannot supply composed text, citations, or a rule identity.
   * - Only a currently eligible projected leaf may be imported, and the existing saveRule path rechecks every citation and catalog revision.
   * Execution flow:
   * 1. Resolve the target catalog and its pinned source version.
   * 2. Recompute the complete source projection and locate the requested document/leaf identity.
   * 3. Save the server-created rule fields through the existing catalog authority.
   * Failure cases:
   * - Missing or ineligible leaves reject; excessive source context returns a typed SOURCE_CONTEXT_TOO_LARGE problem.
   * Side effects:
   * - Upserts one LegalRule and writes the existing catalog audit event through saveRule.
   */
  async importSourceProvision(
    catalogId: string,
    input: LegalRuleSourceProvisionImport,
    actor: string,
    cid: string,
  ) {
    const catalog = await this.prisma.legalRuleCatalogVersion.findUnique({
      where: { id: catalogId },
      select: { id: true, legalSourceVersionId: true },
    });
    if (!catalog) catalogFailure(E.NOT_FOUND, cid, 404);
    const projection = await this.sourceProvisionProjection(
      catalog.legalSourceVersionId,
      input.documentId,
      cid,
    );
    const provision = projection.items.find(
      (item) => item.locator === input.locator,
    );
    if (!provision) {
      if (
        projection.limitations.some(
          (limitation) =>
            limitation.locator === input.locator &&
            limitation.reason ===
              LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.CONTEXT_TOO_LARGE,
        )
      )
        catalogFailure(E.SOURCE_CONTEXT_TOO_LARGE, cid, 422);
      catalogFailure(E.INELIGIBLE, cid, 422);
    }
    return this.saveRule(
      catalogId,
      {
        legalRuleId: provision.legalRuleId,
        title: provision.title,
        description: provision.description,
        citationLocatorRefs: provision.citationLocatorRefs,
        expectedRevision: input.expectedRevision,
      },
      actor,
      cid,
    );
  }

  /**
   * Business purpose: Create an editable canonical catalog bound to a real source version.
   * Business rules:
   * - Chunking never calls this writer; only explicit Admin input names the catalog.
   * Execution flow:
   * 1. Validate the source identity
   * 2. Insert the catalog and audit atomically.
   * Failure cases:
   * - Missing sources or duplicate version names reject without partial writes.
   * Side effects:
   * - Creates one catalog and an audit event; no rule or model call is created.
   */
  async create(
    input: { version: string; legalSourceVersionId: string },
    actor: string,
    cid: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.legalSourceVersion.findUnique({
          where: { id: input.legalSourceVersionId },
        }))
      )
        catalogFailure(E.INELIGIBLE, cid);
      const catalog = await tx.legalRuleCatalogVersion.create({
        data: { ...input, createdBy: actor, updatedBy: actor },
      });
      await this.record(tx, EVENTS.SAVED, catalog.id, actor, cid, {
        revision: catalog.revision,
      });
      return catalog;
    });
  }

  /**
   * Business purpose: Permanently delete an idle LegalRule catalog and its owned descendants.
   * Business rules:
   * - Cannot delete a catalog while associated rule preparation runs are queued or active.
   * Execution flow:
   * 1. Lock the catalog row and verify existence
   * 2. Ensure no active preparation runs are in flight
   * 3. Cascade delete preparation results, rules, batches, selections, and catalog
   * 4. Record audit trail evidence
   * Failure cases:
   * - Missing catalog returns 404; active runs return 409 conflict.
   * Side effects:
   * - Removes the catalog and child records atomically and writes an audit event.
   */
  async deleteCatalog(catalogId: string, actor: string, cid: string) {
    return this.prisma.$transaction(async (tx) => {
      // Why: A selected-rule submit can create a run after an unlocked deletion check.
      // How: Serialize deletion with the same catalog row lock taken by submit/import.
      // Invariant: The unresolved-run query observes all earlier creators before deleting descendants.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "LegalRuleCatalogVersion" WHERE "id" = ${catalogId} FOR UPDATE
      `;
      if (!locked.length) catalogFailure(E.NOT_FOUND, cid, 404);
      const catalog = await tx.legalRuleCatalogVersion.findUnique({
        where: { id: catalogId },
      });
      if (!catalog) catalogFailure(E.NOT_FOUND, cid, 404);

      const activeRuns = await tx.preparationRuleResult.findFirst({
        where: {
          preparationRule: {
            legalRule: {
              catalogVersionId: catalogId,
            },
          },
          preparationRun: {
            executionState: {
              // Why: Native cancellation can remain in progress after the Admin request commits.
              // How: Use the canonical unresolved set for the deletion fence.
              // Invariant: Catalog rows cannot be removed while a selected-rule run may still publish.
              in: RULE_SET_PREPARATION_UNRESOLVED_STATES.map(
                (state) => state as AgentExecutionState,
              ),
            },
          },
        },
      });
      if (activeRuns) catalogFailure(E.CONFLICT, cid, 409);

      await tx.preparationRuleResult.deleteMany({
        where: {
          preparationRule: {
            legalRule: {
              catalogVersionId: catalogId,
            },
          },
        },
      });

      await tx.preparationRule.deleteMany({
        where: {
          legalRule: {
            catalogVersionId: catalogId,
          },
        },
      });

      await tx.preparationRuleBatch.deleteMany({
        where: {
          selection: {
            catalogVersionId: catalogId,
          },
        },
      });

      await tx.preparationRuleSelection.deleteMany({
        where: {
          catalogVersionId: catalogId,
        },
      });

      await tx.legalRule.deleteMany({
        where: {
          catalogVersionId: catalogId,
        },
      });

      await tx.legalRuleCatalogVersion.delete({
        where: { id: catalogId },
      });

      await this.record(tx, EVENTS.DELETED, catalogId, actor, cid, {
        version: catalog.version,
      });

      return { id: catalogId, deleted: true as const };
    });
  }

  /**
   * Business purpose: Serialize catalog edits and selection against one explicit revision.
   * Business rules:
   * - A stale page cannot overwrite concurrent Admin edits.
   * Execution flow:
   * 1. Lock the catalog row
   * 2. Require its expected revision.
   * Failure cases:
   * - Missing catalogs return 404; mismatched revisions return conflict.
   * Side effects:
   * - Holds the row lock until the caller transaction ends.
   */
  async lock(tx: CatalogClient, id: string, revision: number, cid: string) {
    const rows = await tx.$queryRaw<
      Array<{ revision: number }>
    >`SELECT "revision" FROM "LegalRuleCatalogVersion" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows.length) catalogFailure(E.NOT_FOUND, cid, 404);
    if (rows[0].revision !== revision) catalogFailure(E.STALE, cid);
  }

  /**
   * Business purpose: Save an explicitly authored LegalRule while keeping downstream artifacts separate.
   * Business rules:
   * - References must resolve to non-repealed chunks of the catalog's indexed source; edits advance the catalog revision.
   * Execution flow:
   * 1. Lock revision
   * 2. Resolve citations
   * 3. Upsert the rule and increment revision
   * 4. Audit.
   * Failure cases:
   * - Stale revisions, unresolved citations, unavailable indexes or catalog overflow roll back.
   * Side effects:
   * - Updates the editable catalog and audit only; never runs extraction or preparation.
   */
  async saveRule(
    catalogId: string,
    input: LegalRuleWrite,
    actor: string,
    cid: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, catalogId, input.expectedRevision, cid);
      const catalog = await tx.legalRuleCatalogVersion.findUniqueOrThrow({
        where: { id: catalogId },
      });
      const source = await tx.legalSourceVersion.findUniqueOrThrow({
        where: { id: catalog.legalSourceVersionId },
        include: {
          retrievalIndexes: {
            where: {
              status: LegalRetrievalIndexStatus.VALID,
              validatedAt: { not: null },
              validationManifestRef: { not: null },
            },
            take: 1,
          },
        },
      });
      if (
        source.status !== LegalSourceLifecycleStatus.ACTIVE &&
        source.status !== LegalSourceLifecycleStatus.SUPERSEDED
      )
        catalogFailure(E.INELIGIBLE, cid);
      if (!source.retrievalIndexes.length) catalogFailure(E.INELIGIBLE, cid);
      const citations = await tx.legalDocumentChunk.findMany({
        where: {
          legalSourceVersionId: source.id,
          OR: input.citationLocatorRefs,
        },
        select: { documentId: true, locator: true, legalEffectStatus: true },
      });
      if (
        input.citationLocatorRefs.some(
          (ref) =>
            !citations.some(
              (chunk) =>
                chunk.documentId === ref.documentId &&
                chunk.locator === ref.locator &&
                isEligibleLegalChunkStatus(chunk.legalEffectStatus),
            ),
        )
      )
        catalogFailure(E.INELIGIBLE, cid);
      const existing = await tx.legalRule.findUnique({
        where: {
          catalogVersionId_legalRuleId: {
            catalogVersionId: catalogId,
            legalRuleId: input.legalRuleId,
          },
        },
      });
      if (
        !existing &&
        (await tx.legalRule.count({
          where: { catalogVersionId: catalogId },
        })) >= LEGAL_RULE_LIMITS.catalogRules
      )
        catalogFailure(E.TOO_LARGE, cid);
      const data = {
        title: input.title,
        description: input.description,
        citationLocatorRefs: input.citationLocatorRefs,
        updatedBy: actor,
      };
      const rule = await tx.legalRule.upsert({
        where: {
          catalogVersionId_legalRuleId: {
            catalogVersionId: catalogId,
            legalRuleId: input.legalRuleId,
          },
        },
        update: data,
        create: {
          ...data,
          catalogVersionId: catalogId,
          legalRuleId: input.legalRuleId,
          authoredBy: actor,
        },
      });
      const updated = await tx.legalRuleCatalogVersion.update({
        where: { id: catalogId },
        data: { revision: { increment: 1 }, updatedBy: actor },
      });
      await this.record(tx, EVENTS.SAVED, rule.id, actor, cid, {
        catalogVersionId: catalogId,
        revision: updated.revision,
      });
      return { rule, catalogRevision: updated.revision };
    });
  }

  /**
   * Business purpose: Project eligibility and preparation freshness from canonical rows.
   * Business rules:
   * - No model calls; a VALID index and every exact citation are required. Counts reflect the latest parseable persisted output; PREPARED additionally requires a successful run and a matching current input snapshot, source pin, and fingerprint.
   * Execution flow:
   * 1. Read catalog/rules/latest results
   * 2. Resolve chunk metadata in one query
   * 3. Compute pins and state.
   * Failure cases:
   * - Missing catalogs reject; unavailable sources and citations remain visible as ineligible.
   * Side effects:
   * - Read-only transaction queries.
   */
  async entries(tx: CatalogClient, catalogId: string, cid: string) {
    const catalog = await tx.legalRuleCatalogVersion.findUnique({
      where: { id: catalogId },
      include: {
        legalSourceVersion: {
          include: {
            retrievalIndexes: {
              where: {
                status: LegalRetrievalIndexStatus.VALID,
                validatedAt: { not: null },
                validationManifestRef: { not: null },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
        rules: {
          orderBy: { legalRuleId: "asc" },
          take: LEGAL_RULE_LIMITS.catalogRules + 1,
          include: {
            preparation: {
              include: {
                results: {
                  orderBy: { revision: "desc" },
                  take: 1,
                  include: { preparationRun: true },
                },
              },
            },
          },
        },
      },
    });
    if (!catalog) catalogFailure(E.NOT_FOUND, cid, 404);
    if (catalog.rules.length > LEGAL_RULE_LIMITS.catalogRules)
      catalogFailure(E.TOO_LARGE, cid);
    const source = catalog.legalSourceVersion;
    const index = source.retrievalIndexes[0];
    const refs = [
      ...new Map(
        catalog.rules
          .flatMap((rule) =>
            z.array(legalRuleCitationSchema).parse(rule.citationLocatorRefs),
          )
          .map((ref) => [canonicalJson(ref), ref]),
      ).values(),
    ];
    const chunks = refs.length
      ? await tx.legalDocumentChunk.findMany({
          where: { legalSourceVersionId: source.id, OR: refs },
          select: {
            id: true,
            documentId: true,
            locator: true,
            contentSha256: true,
            legalEffectStatus: true,
          },
        })
      : [];
    const byLocator = new Map(
      chunks.map((chunk) => [
        canonicalJson([chunk.documentId, chunk.locator]),
        chunk,
      ]),
    );
    const items = catalog.rules.map((rule) => {
      const citations = z
        .array(legalRuleCitationSchema)
        .parse(rule.citationLocatorRefs)
        .map((ref) =>
          byLocator.get(canonicalJson([ref.documentId, ref.locator])),
        );
      const reason =
        source.status !== LegalSourceLifecycleStatus.ACTIVE &&
        source.status !== LegalSourceLifecycleStatus.SUPERSEDED
          ? R.SOURCE_UNAVAILABLE
          : !index
            ? R.INDEX_UNAVAILABLE
            : !citations.length ||
                citations.some(
                  (ref) =>
                    !ref || !isEligibleLegalChunkStatus(ref.legalEffectStatus),
                )
              ? R.CITATION_INVALID
              : null;
      const input: PreparationRuleInput | null =
        reason || !citations.length
          ? null
          : {
              ruleId: rule.id,
              legalRuleId: rule.legalRuleId,
              title: rule.title,
              description: rule.description,
              catalogVersionId: catalog.id,
              catalogVersion: catalog.version,
              catalogRevision: catalog.revision,
              legalSourceVersionId: source.id,
              sourceVersion: source.version,
              indexId: index.id,
              indexContentHash: index.contentHash,
              citations: citations.map((chunk) => ({
                chunkId: chunk!.id,
                documentId: chunk!.documentId,
                locator: chunk!.locator,
                contentSha256: chunk!.contentSha256,
                content: "",
              })),
            };
      const last = rule.preparation?.results[0] ?? null;
      const resultInput = last
        ? preparationRuleInputSchema.safeParse(last.inputSnapshot)
        : null;
      const currentResult = Boolean(
        last &&
        input &&
        resultInput?.success &&
        last.preparationRun.legalSourceVersionId === source.id &&
        last.inputFingerprint === preparationInputFingerprint(input) &&
        preparationInputFingerprint(resultInput.data) === last.inputFingerprint,
      );
      // Why: Pending native cancellation is an unresolved run, not a failed/stale catalog result.
      // How: Project every canonical unresolved execution state to the existing in-progress UI state.
      // Invariant: Admin status remains pending until durable cancellation reaches a terminal state.
      const state = reason
        ? S.INELIGIBLE
        : !last
          ? S.NOT_PREPARED
          : RULE_SET_PREPARATION_UNRESOLVED_STATES.some(
                (unresolved) =>
                  unresolved === last.preparationRun.executionState,
              )
            ? S.RUNNING
            : !currentResult
              ? S.STALE
              : last.preparationRun.executionState ===
                  AgentExecutionState.SUCCEEDED
                ? S.PREPARED
                : S.FAILED;
      const parsedOutput = last?.output
        ? preparationRuleOutputSchema.safeParse(last.output)
        : null;
      const assessmentRuleCount =
        state === S.PREPARED && parsedOutput?.success
          ? parsedOutput.data.assessmentRules.length
          : 0;
      return {
        id: rule.id,
        legalRuleId: rule.legalRuleId,
        title: rule.title,
        description: rule.description,
        citationLocatorRefs: rule.citationLocatorRefs,
        state,
        ineligibleReason: reason,
        lastResultId: last?.id ?? null,
        lastRunId: last?.preparationRunId ?? null,
        lastResultRevision: last?.revision ?? null,
        lastOutcome: last?.preparationRun.executionState ?? null,
        assessmentRuleCount,
        input,
      };
    });
    return { catalog, items };
  }

  /**
   * Business purpose: Page searchable rule eligibility on the server, independently of browser selection.
   * Business rules:
   * - Filtering never changes a previously persisted selection. Derived state requires the complete bounded catalog projection.
   * Execution flow:
   * 1. Read consistent entries
   * 2. Apply search/state filters
   * 3. Return one bounded page and exact totals.
   * Failure cases:
   * - Missing/oversized catalogs reject without an invented empty result.
   * Side effects:
   * - Read-only repeatable-read transaction.
   */
  async list(catalogId: string, query: LegalRuleList, cid: string) {
    // shortcut: derived-state filtering scans a catalog capped at 10,000 rules; move it into a read projection before raising that cap.
    return this.prisma.$transaction(
      async (tx) => {
        const { catalog, items } = await this.entries(tx, catalogId, cid);
        const matching = this.filter(items, query);
        return {
          catalogVersionId: catalog.id,
          catalogVersion: catalog.version,
          catalogRevision: catalog.revision,
          legalSourceVersionId: catalog.legalSourceVersionId,
          total: matching.length,
          eligibleTotal: matching.filter((item) => !item.ineligibleReason)
            .length,
          page: query.page,
          limit: query.limit,
          items: matching
            .slice((query.page - 1) * query.limit, query.page * query.limit)
            .map((item) => legalRuleListItemSchema.parse(item)),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Business purpose: Apply the same server filter to page reads and Select all matching.
   * Business rules:
   * - Search spans stable identity, title, description and citation text; state filtering is exact. Assessment Rule filtering requires a current PREPARED result with a non-zero persisted rule count.
   * Execution flow:
   * 1. Normalize search
   * 2. Retain matching entries.
   * Failure cases:
   * - Boundary schemas reject invalid filters before this pure operation.
   * Side effects:
   * - Returns matching rows without mutating catalog, selection or run state.
   */
  filter<
    T extends {
      legalRuleId: string;
      title: string;
      description: string;
      citationLocatorRefs: unknown;
      state: string;
      assessmentRuleCount: number;
    },
  >(
    items: T[],
    query: Pick<LegalRuleList, "search" | "state" | "withAssessmentRules">,
  ): T[] {
    const search = query.search.toLocaleLowerCase("en-US");
    return items.filter(
      (item) =>
        (!query.state || item.state === query.state) &&
        (!query.withAssessmentRules ||
          (item.state === S.PREPARED && item.assessmentRuleCount > 0)) &&
        (!search ||
          `${item.legalRuleId} ${item.title} ${item.description} ${JSON.stringify(item.citationLocatorRefs)}`
            .toLocaleLowerCase("en-US")
            .includes(search)),
    );
  }

  /**
   * Business purpose: Freeze the exact explicit or all-matching eligible selection before confirmation.
   * Business rules:
   * - Empty/foreign/ineligible IDs reject; all-matching spans the server result, never the visible page. Only this actor may submit it.
   * Execution flow:
   * 1. Lock catalog revision
   * 2. Resolve selected entries and exact content
   * 3. Save scope, inputs and fingerprint atomically.
   * Failure cases:
   * - Invalid, stale, empty, ineligible or oversized selections roll back without dispatch.
   * Side effects:
   * - Persists a selection preview and audit; creates no Preparation Rule or model work.
   */
  async select(request: LegalRuleSelection, actor: string, cid: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(
        tx,
        request.catalogVersionId,
        request.expectedRevision,
        cid,
      );
      const { items } = await this.entries(tx, request.catalogVersionId, cid);
      const ids = new Set(request.ruleIds);
      const selected =
        request.mode === MODES.ALL_MATCHING
          ? this.filter(items, request.filters).filter(
              (item) => !item.ineligibleReason,
            )
          : items.filter((item) => ids.has(item.id));
      if (request.mode === MODES.EXPLICIT && ids.size !== selected.length)
        catalogFailure(E.INELIGIBLE, cid);
      if (!selected.length) catalogFailure(E.EMPTY, cid, 422);
      if (
        request.mode === MODES.EXPLICIT &&
        (ids.size !== selected.length || selected.some((item) => !item.input))
      )
        catalogFailure(E.INELIGIBLE, cid);
      const inputs = await this.hydrate(
        tx,
        selected.map((item) => item.input!),
        cid,
      );
      if (Buffer.byteLength(JSON.stringify(inputs), "utf8") > 16 * 1024 * 1024)
        catalogFailure(E.TOO_LARGE, cid, 422);
      const fingerprint = sha256Hex(
        canonicalJson(inputs.map(preparationInputFingerprint)),
      );
      const selection = await tx.preparationRuleSelection.create({
        data: {
          catalogVersionId: request.catalogVersionId,
          catalogRevision: request.expectedRevision,
          createdBy: actor,
          scope: request,
          inputs: inputs,
          fingerprint,
        },
      });
      await this.record(tx, EVENTS.SELECTED, selection.id, actor, cid, {
        selectedCount: inputs.length,
        fingerprint,
      });
      return {
        selectionId: selection.id,
        selectedCount: inputs.length,
        ruleIds: inputs.map((input) => input.ruleId),
        catalogRevision: selection.catalogRevision,
        scope: request,
        fingerprint,
      };
    });
  }

  /**
   * Business purpose: Pin exact source bytes for selected rule execution.
   * Business rules:
   * - Every chunk/hash must still match; content is loaded only for selected inputs and never synthesized.
   * - New selected preparation, regeneration, model-free import and publication use admitted official originals.
   * Execution flow:
   * 1. Require source admission, then read selected chunks
   * 2. Verify stored and computed hashes
   * 3. Validate complete snapshots.
   * Failure cases:
   * - Missing/changed/empty source content rejects before dispatch.
   * Side effects:
   * - Read-only; returns source content for durable pinning.
   */
  async hydrate(
    tx: CatalogClient,
    inputs: PreparationRuleInput[],
    cid: string,
  ) {
    // All selected authoring paths enter here before writing results or dispatching agents.
    // Keep historical browsing independent of admission for new work.
    for (const versionId of new Set(
      inputs.map((input) => input.legalSourceVersionId),
    )) {
      await this.authority.requireVersion(tx, versionId, cid);
    }
    const indexes = await tx.legalRetrievalIndex.findMany({
      where: {
        id: { in: [...new Set(inputs.map((input) => input.indexId))] },
        status: LegalRetrievalIndexStatus.VALID,
        validatedAt: { not: null },
        validationManifestRef: { not: null },
      },
      include: { legalSourceVersion: { select: { status: true } } },
    });
    const byIndex = new Map(indexes.map((index) => [index.id, index]));
    for (const input of inputs) {
      const index = byIndex.get(input.indexId);
      if (
        !index ||
        index.legalSourceVersionId !== input.legalSourceVersionId ||
        index.contentHash !== input.indexContentHash ||
        (index.legalSourceVersion.status !==
          LegalSourceLifecycleStatus.ACTIVE &&
          index.legalSourceVersion.status !==
            LegalSourceLifecycleStatus.SUPERSEDED)
      )
        catalogFailure(E.INELIGIBLE, cid);
    }
    const chunks = await tx.legalDocumentChunk.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              inputs.flatMap((input) =>
                input.citations.map((ref) => ref.chunkId),
              ),
            ),
          ],
        },
      },
    });
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    return inputs.map((input) =>
      preparationRuleInputSchema.parse({
        ...input,
        citations: input.citations.map((ref) => {
          const chunk = byId.get(ref.chunkId);
          // Why: Windows CRLF and Unix LF newlines must produce identical hash verification to avoid false rejections.
          // How: Normalize carriage returns (\r\n to \n) before computing sha256Hex for chunk verification.
          // Invariant: Pinned canonical source hashes remain compatible across OS environments.
          const normalizedContent = chunk ? chunk.content.replace(/\r\n/gu, "\n") : "";
          const expectedHash = ref.contentSha256.replace(/^sha256:/u, "");
          const matchesHash =
            chunk &&
            (chunk.contentSha256 === ref.contentSha256 ||
              chunk.contentSha256.replace(/^sha256:/u, "") === expectedHash) &&
            (sha256Hex(chunk.content) === expectedHash ||
              sha256Hex(normalizedContent) === expectedHash);

          if (
            !chunk ||
            !chunk.content.trim() ||
            chunk.legalSourceVersionId !== input.legalSourceVersionId ||
            chunk.documentId !== ref.documentId ||
            chunk.locator !== ref.locator ||
            !matchesHash ||
            !isEligibleLegalChunkStatus(chunk.legalEffectStatus)
          )
            catalogFailure(E.INELIGIBLE, cid);
          return { ...ref, content: chunk.content };
        }),
      }),
    );
  }

  /**
   * Business purpose: Keep catalog and preparation actions in the existing audit journal.
   * Business rules:
   * - Caller's transaction owns audit atomicity; source text is never copied into audit payloads.
   * - A supplied idempotency identity preserves one receipt for an identical import replay.
   * Execution flow:
   * 1. Delegate safe identities and scalar metadata to the canonical writer.
   * Failure cases:
   * - Audit persistence failure rolls back the caller mutation.
   * Side effects:
   * - Inserts an AuditEvent in the current transaction.
   */
  async record(
    tx: CatalogClient,
    eventType: string,
    resourceId: string,
    actor: string,
    cid: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ) {
    await this.audit.writeInTx(
      {
        eventType,
        actorId: actor,
        resourceType: AUDIT_RESOURCE_TYPES.httpRoute,
        resourceId,
        correlationId: cid,
        decision: AUDIT_DECISIONS.allow,
        payload,
        // Reuse the audit writer's stable identity for import receipts only.
        ...(idempotencyKey ? { idempotencyKey } : {}),
      },
      tx,
    );
  }
}
