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
  legalRuleCitationSchema,
  legalRuleListItemSchema,
  preparationRuleInputSchema,
  type LegalRuleWrite,
  type LegalRuleList,
  type LegalRuleSelection,
  type PreparationRuleInput,
} from "@lcsp/contracts/legal-rule-catalog";
import { AUDIT_RESOURCE_TYPES, AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../assessment/domain/domain-ids.js";

export type CatalogClient = Prisma.TransactionClient;

/**
 * Business purpose: Fingerprint pinned rule inputs independently of their display order.
 * Business rules:
 * - Source hashes bind content; the snapshot retains the exact content separately.
 * Execution flow:
 * 1. Canonicalize identity, revisions and citations
 * 2. Hash the serialization.
 * Failure cases:
 * - Invalid inputs must be rejected by their boundary schema first.
 * Side effects:
 * - Pure hashing, with no model or persistence access.
 */
export function preparationInputFingerprint(
  input: PreparationRuleInput,
): string {
  return sha256Hex(
    canonicalJson({
      ...input,
      citations: input.citations.map((ref) => ({
        chunkId: ref.chunkId,
        documentId: ref.documentId,
        locator: ref.locator,
        contentSha256: ref.contentSha256,
      })),
    }),
  );
}

/**
 * Business purpose: Report a typed catalog rejection through the shared API envelope.
 * Business rules:
 * - Rejections never create catalog or model work.
 * Execution flow:
 * 1. Construct the requested problem and throw it.
 * Failure cases:
 * - Always rejects with the supplied HTTP status and canonical code.
 * Side effects:
 * - Throws a typed problem without accessing persistence or model providers.
 */
export function catalogFailure(
  code: (typeof E)[keyof typeof E],
  correlationId: string,
  status = 409,
): never {
  throw problemException(code, correlationId, { status });
}

@Injectable()
export class LegalRuleCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriterService,
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
              in: [AgentExecutionState.QUEUED, AgentExecutionState.RUNNING],
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
                chunk.legalEffectStatus === LegalEffectStatus.EFFECTIVE,
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
   * - No model calls; a VALID index and every exact citation are required. Catalog size is bounded at write time.
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
                    !ref ||
                    ref.legalEffectStatus !== LegalEffectStatus.EFFECTIVE,
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
      const state = reason
        ? S.INELIGIBLE
        : !last
          ? S.NOT_PREPARED
          : last.preparationRun.executionState === AgentExecutionState.QUEUED ||
              last.preparationRun.executionState === AgentExecutionState.RUNNING
            ? S.RUNNING
            : last.inputFingerprint !== preparationInputFingerprint(input!)
              ? S.STALE
              : last.preparationRun.executionState ===
                  AgentExecutionState.SUCCEEDED
                ? S.PREPARED
                : S.FAILED;
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
        lastOutcome: last?.preparationRun.executionState ?? null,
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
   * - Search spans stable identity, title, description and citation text; state filtering is exact.
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
    },
  >(items: T[], query: Pick<LegalRuleList, "search" | "state">): T[] {
    const search = query.search.toLocaleLowerCase("en-US");
    return items.filter(
      (item) =>
        (!query.state || item.state === query.state) &&
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
   * Execution flow:
   * 1. Read selected chunks
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
          if (
            !chunk ||
            !chunk.content.trim() ||
            chunk.legalSourceVersionId !== input.legalSourceVersionId ||
            chunk.documentId !== ref.documentId ||
            chunk.locator !== ref.locator ||
            chunk.contentSha256 !== ref.contentSha256 ||
            sha256Hex(chunk.content) !==
              ref.contentSha256.replace(/^sha256:/u, "") ||
            chunk.legalEffectStatus !== LegalEffectStatus.EFFECTIVE
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
    payload: Record<string, string | number>,
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
      },
      tx,
    );
  }
}
