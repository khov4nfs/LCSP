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
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { LegalDocumentGraphService } from "../../../legal-source/application/services/legal-document-graph.service.js";
import { attachLegalRuleReferenceContext } from "./legal-rule-reference-context.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../assessment/domain/domain-ids.js";

export type CatalogClient = Prisma.TransactionClient;

type SourceProvisionChunk = {
  id: string;
  documentId: string;
  locator: string;
  content: string;
  contentSha256: string;
  hierarchy: Prisma.JsonValue;
  legalEffectStatus: LegalEffectStatus;
};

/**
 * Business purpose: Project eligible Article–Clause–Point leaf provisions with their exact applicable parent context for source import.
 *
 * Business rules:
 * - Only EFFECTIVE Article, Clause or Point chunks with a classified hierarchy can become source rules.
 * - A parent with descendants is selectable only when its own chunk contains provision text beyond its structural heading and setup lead-in.
 * - Parent headings and lead-ins come from metadata; independently substantive parent chunks remain distinct selectable rules.
 * - Exact EFFECTIVE ancestor chunks are included as context for the selected provision. Siblings, unrelated provisions and non-effective ancestor groups are excluded.
 * - Split chunks collapse to one logical provision while each persisted part remains an exact citation reference.
 *
 * Execution flow:
 * 1. Group eligible persisted chunk parts by their locator without the transport-only part suffix.
 * 2. Determine descendants and retain only legal leaves or explicitly substantive parent provisions.
 * 3. Compose recorded Article heading/lead-in, Clause heading/lead-in and the selected leaf in reading order with exact line de-duplication.
 * 4. Cite the selected provision and its effective ancestors within the existing bound; return the stable identity and context limitations.
 *
 * Failure cases:
 * - Unclassified and malformed-locator chunks are omitted; non-effective and context-incomplete provisions are returned as typed limitations, never treated as eligible or silently presented as absent.
 *
 * Side effects:
 * - None: this deterministic projection reads immutable source rows and creates no LegalRule or source mutation.
 */
export function composeLegalSourceProvisions(input: {
  sourceVersionId: string;
  documentId: string;
  documentTitle: string;
  chunks: SourceProvisionChunk[];
}): {
  items: LegalRuleSourceProvision[];
  limitations: LegalRuleSourceProvisionLimitation[];
} {
  /**
   * Business purpose: Normalize transport part suffixes to the logical provision identity.
   * Business rules:
   * - Ignore only the trailing persisted part marker; preserve every legal hierarchy segment.
   *
   * Execution flow:
   * 1. Remove one recognized part suffix and return the logical locator.
   *
   * Failure cases:
   * - Unrecognized suffixes remain part of the locator for the provision parser to reject.
   *
   * Side effects:
   * - Pure string normalization; source rows are unchanged.
   */
  const baseLocator = (locator: string) => locator.replace(/::part-\d+$/u, "");
  /**
   * Business purpose: Read source hierarchy metadata without trusting malformed JSON shapes.
   * Business rules:
   * - Only a non-array JSON object may supply Article, Clause, or Point metadata.
   *
   * Execution flow:
   * 1. Validate the stored value's object shape and return its fields when valid.
   *
   * Failure cases:
   * - Non-object metadata produces an empty hierarchy and is handled as unresolved downstream.
   *
   * Side effects:
   * - Pure in-memory projection; no persisted hierarchy is changed.
   */
  const readHierarchy = (chunk: SourceProvisionChunk) =>
    chunk.hierarchy &&
    typeof chunk.hierarchy === "object" &&
    !Array.isArray(chunk.hierarchy)
      ? (chunk.hierarchy as Record<string, unknown>)
      : {};
  /**
   * Business purpose: Accept only Article–Clause–Point locator paths for provision composition.
   * Business rules:
   * - Structural-only and unstructured locator families are never accepted as legal leaves.
   *
   * Execution flow:
   * 1. Remove transport suffixes and parse supported Article-Clause-Point segments.
   *
   * Failure cases:
   * - Invalid order, unsupported depth, and malformed segments return null for unresolved review.
   *
   * Side effects:
   * - Pure locator parsing; no source identity is rewritten.
   */
  const parseProvisionLocator = (locator: string) => {
    const identityLocator = baseLocator(locator);
    const structuralLocator = identityLocator.replace(/::dup-\d+$/u, "");
    const segments = structuralLocator.split("::");
    if (
      segments.length < 1 ||
      segments.length > 3 ||
      !/^art-[\p{L}\d._-]+$/u.test(segments[0]) ||
      (segments.length >= 2 && !/^cl-[\p{L}\d._-]+$/u.test(segments[1])) ||
      (segments.length === 3 && !/^pt-[\p{L}\d._-]+$/u.test(segments[2]))
    )
      return null;
    return { identityLocator, segments };
  };
  /**
   * Business purpose: Compare source lines for exact duplicate suppression.
   * Business rules:
   * - Comparison normalization must never alter wording emitted in a LegalRule description.
   *
   * Execution flow:
   * 1. Build a comparison key from Unicode-normalized, whitespace-collapsed source text.
   *
   * Failure cases:
   * - Empty text produces an empty comparison key.
   *
   * Side effects:
   * - Pure string normalization; source wording is unchanged.
   */
  const normalized = (value: string) =>
    value
      .normalize("NFC")
      .replace(/\s+/gu, " ")
      .trim()
      .toLocaleLowerCase("vi-VN");
  const limitations: LegalRuleSourceProvisionLimitation[] = [];
  /**
   * Business purpose: Keep each unresolved source locator visible once in the projection response.
   * Business rules:
   * - A limitation is unique by source locator and typed reason so unresolved coverage stays concise.
   *
   * Execution flow:
   * 1. Check whether the locator/reason pair already exists.
   * 2. Append the pair only when it is new.
   *
   * Failure cases:
   * - Duplicate pairs are ignored; invalid typed reasons are rejected by the contract boundary.
   *
   * Side effects:
   * - Mutates only this projection's in-memory limitation list.
   */
  const addLimitation = (
    locator: string,
    reason: LegalRuleSourceProvisionLimitation["reason"],
  ) => {
    if (
      !limitations.some(
        (item) => item.locator === locator && item.reason === reason,
      )
    )
      limitations.push({ locator, reason });
  };
  /**
   * Business purpose: Convert validated hierarchy primitives to display text without coercing malformed JSON into legal prose.
   *
   * Business rules:
   * - Narrative hierarchy fields accept strings only; Article and Clause numbers may also be finite numbers.
   * - Objects, arrays, booleans, and non-finite numbers are invalid context and must remain unresolved.
   *
   * Execution flow:
   * 1. Trim string values and return them unchanged otherwise.
   * 2. Convert finite numeric identifiers only when the field permits numeric values.
   * 3. Return null for malformed values so the caller can surface a typed limitation.
   *
   * Failure cases:
   * - Unsupported JSON values return null and are not stringified into a LegalRule description.
   *
   * Side effects:
   * - Pure validation and formatting of an in-memory hierarchy value.
   */
  const hierarchyText = (
    value: unknown,
    allowNumber: boolean,
  ): string | null => {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value.trim();
    if (allowNumber && typeof value === "number" && Number.isFinite(value)) {
      return value.toString();
    }
    return null;
  };
  const groups = new Map<
    string,
    {
      identityLocator: string;
      segments: string[];
      chunks: SourceProvisionChunk[];
      hierarchy: Record<string, unknown>;
    }
  >();
  for (const chunk of input.chunks) {
    const parsed = parseProvisionLocator(chunk.locator);
    const hierarchy = readHierarchy(chunk);
    if (!parsed || hierarchy.structureClassification === "UNCLASSIFIED") {
      addLimitation(
        chunk.locator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.UNCLASSIFIED,
      );
      continue;
    }
    const group = groups.get(parsed.identityLocator) ?? {
      ...parsed,
      chunks: [],
      hierarchy,
    };
    group.chunks.push(chunk);
    groups.set(parsed.identityLocator, group);
  }

  const sourceGroups = [...groups.values()].sort((left, right) =>
    left.identityLocator.localeCompare(right.identityLocator, "en", {
      numeric: true,
    }),
  );
  const items: LegalRuleSourceProvision[] = [];
  /**
   * Business purpose: Reassemble exact persisted text parts for one logical provision.
   * Business rules:
   * - Part order follows persisted locator order and original non-empty source wording is retained.
   *
   * Execution flow:
   * 1. Sort the stored parts, trim only their outer whitespace, and join them with line breaks.
   *
   * Failure cases:
   * - Missing groups produce empty text; source content is never reconstructed.
   *
   * Side effects:
   * - Pure in-memory projection of persisted content.
   */
  const contentOf = (group: (typeof sourceGroups)[number] | undefined) =>
    group?.chunks
      .slice()
      .sort((left, right) =>
        left.locator.localeCompare(right.locator, "en", { numeric: true }),
      )
      .map((chunk) => chunk.content.trim())
      .filter(Boolean)
      .join("\n") ?? "";
  /**
   * Business purpose: Distinguish a parent's own enforceable text from a heading or child setup lead-in.
   * Business rules:
   * - Explicit chunker metadata is authoritative; otherwise the parent needs residual body text beyond its heading and setup lead-in.
   * - A trailing setup colon alone is not treated as an independent obligation.
   *
   * Execution flow:
   * 1. Require an existing, EFFECTIVE parent chunk.
   * 2. Check the independent-substance marker, then compare body lines with hierarchy heading and lead-in metadata.
   *
   * Failure cases:
   * - Missing or non-effective parent chunks cannot establish independent legal content.
   *
   * Side effects:
   * - Pure classification of persisted source text; no parent content is copied or changed.
   */
  const hasIndependentParentContent = (
    group: (typeof sourceGroups)[number] | undefined,
    heading: string,
    leadIn: string,
  ) => {
    if (
      !group ||
      !group.chunks.length ||
      group.chunks.some(
        (chunk) => chunk.legalEffectStatus !== LegalEffectStatus.EFFECTIVE,
      )
    )
      return false;
    if (group.hierarchy.independentlySubstantive === true) return true;
    const metadataLines = new Set(
      [heading, ...leadIn.split(/\r?\n/u)].map(normalized).filter(Boolean),
    );
    const residual = group.chunks
      .flatMap((chunk) => chunk.content.split(/\r?\n/u))
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        const key = normalized(line);
        if (metadataLines.has(key)) return false;
        if (leadIn && key.endsWith(normalized(leadIn))) return false;
        return true;
      });
    const leadInLines = leadIn.split(/\r?\n/u).map((line) => line.trim());
    const hasPriorSentence =
      leadInLines.slice(0, -1).some((line) => /[.;?!]$/u.test(line)) ||
      /[.;?!]\s+\S/u.test(leadIn);
    if (leadIn.trim().endsWith(":") && hasPriorSentence) return true;
    return residual.length > 0 && !leadIn.trim().endsWith(":");
  };

  for (const group of sourceGroups) {
    if (
      group.chunks.some(
        (chunk) => chunk.legalEffectStatus !== LegalEffectStatus.EFFECTIVE,
      )
    ) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.EFFECT_NOT_EFFECTIVE,
      );
      continue;
    }
    const hasDescendant = sourceGroups.some(
      (candidate) =>
        candidate.segments.length > group.segments.length &&
        group.segments.every(
          (segment, index) => candidate.segments[index] === segment,
        ),
    );
    const articleNumberValue = hierarchyText(
      group.hierarchy.articleNumber,
      true,
    );
    const articleTitle = hierarchyText(group.hierarchy.articleTitle, false);
    const articleHeadingValue = hierarchyText(
      group.hierarchy.articleHeading,
      false,
    );
    const articleLeadIn = hierarchyText(group.hierarchy.articleLeadIn, false);
    const clauseNumberValue = hierarchyText(group.hierarchy.clauseNumber, true);
    const clauseNumberingValue = hierarchyText(
      group.hierarchy.clauseNumbering,
      false,
    );
    const clauseHeadingValue = hierarchyText(
      group.hierarchy.clauseHeading,
      false,
    );
    const clauseLeadIn = hierarchyText(group.hierarchy.clauseLeadIn, false);
    if (
      articleNumberValue === null ||
      articleTitle === null ||
      articleHeadingValue === null ||
      articleLeadIn === null ||
      clauseNumberValue === null ||
      clauseNumberingValue === null ||
      clauseHeadingValue === null ||
      clauseLeadIn === null
    ) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.CONTEXT_UNRESOLVED,
      );
      continue;
    }
    const articleNumber =
      articleNumberValue || group.segments[0]?.slice("art-".length) || "";
    const clauseNumber =
      clauseNumberValue || group.segments[1]?.slice("cl-".length) || "";
    const articleHeading =
      articleHeadingValue ||
      (articleNumber
        ? `Điều ${articleNumber}.${articleTitle ? ` ${articleTitle}` : ""}`
        : "");
    const clauseNumbering =
      clauseNumberingValue || (clauseNumber ? `${clauseNumber}.` : "");
    const clauseHeading = clauseHeadingValue || clauseNumbering;
    const articleParent = sourceGroups.find(
      (candidate) =>
        candidate.segments.length === 1 &&
        candidate.identityLocator === group.segments[0],
    );
    const clauseLocator =
      group.segments.length >= 2 ? group.segments.slice(0, 2).join("::") : "";
    const clauseParent = clauseLocator
      ? sourceGroups.find(
          (candidate) =>
            candidate.segments.length === 2 &&
            candidate.identityLocator === clauseLocator,
        )
      : undefined;
    const independentArticle = hasIndependentParentContent(
      articleParent,
      articleHeading,
      articleLeadIn,
    );
    const independentClause = hasIndependentParentContent(
      clauseParent,
      clauseHeading,
      clauseLeadIn,
    );
    if (
      hasDescendant &&
      !(group.segments.length === 1 ? independentArticle : independentClause)
    )
      continue;

    const sourceContent = contentOf(group);
    const ownHeading =
      group.segments.length === 1 ? articleHeading : clauseNumbering;
    if (
      !hasDescendant &&
      group.segments.length < 3 &&
      ownHeading &&
      sourceContent
        .split(/\r?\n/u)
        .map(normalized)
        .filter(Boolean)
        .every((line) => line === normalized(ownHeading))
    ) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.STRUCTURAL_ONLY,
      );
      continue;
    }

    const clauseLeadInLines = clauseLeadIn.split(/\r?\n/u);
    const clauseHeadingBody = clauseHeading.replace(/^\s*\d+[.)]\s*/u, "");
    const remainingClauseLeadIn =
      clauseLeadInLines.length > 0 &&
      normalized(clauseLeadInLines[0]) === normalized(clauseHeadingBody)
        ? clauseLeadInLines.slice(1).join("\n")
        : clauseLeadIn;
    const clauseContext = [clauseHeading, remainingClauseLeadIn];
    const sourceLineKeys = new Set(
      sourceContent.split(/\r?\n/u).map(normalized).filter(Boolean),
    );
    const contextLines: string[] = [];
    const contextKeys = new Set<string>();
    for (const value of [
      articleHeading,
      group.segments.length >= 2 && independentArticle ? "" : articleLeadIn,
      ...(group.segments.length >= 2
        ? group.segments.length === 3
          ? independentClause
            ? [clauseNumbering]
            : [clauseHeading, remainingClauseLeadIn]
          : clauseContext
        : []),
      sourceContent,
    ]) {
      for (const line of value.split(/\r?\n/u)) {
        const trimmed = line.trim();
        const key = normalized(trimmed);
        if (trimmed && !sourceLineKeys.has(key) && !contextKeys.has(key)) {
          contextLines.push(trimmed);
          contextKeys.add(key);
        }
      }
    }
    const description = [contextLines.join("\n"), sourceContent.trim()]
      .filter(Boolean)
      .join("\n")
      .trim();
    const contextResolved =
      (group.segments.length === 1 || Boolean(articleHeading)) &&
      (group.segments.length < 3 || Boolean(clauseHeading));
    if (!contextResolved) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.CONTEXT_UNRESOLVED,
      );
      continue;
    }
    const citationChunks = [...group.chunks];
    for (const parent of [clauseParent, articleParent]) {
      if (
        parent &&
        parent !== group &&
        parent.chunks.every(
          (chunk) => chunk.legalEffectStatus === LegalEffectStatus.EFFECTIVE,
        )
      )
        citationChunks.push(...parent.chunks);
    }
    if (description.length > 12000 || citationChunks.length > 64) {
      addLimitation(
        group.identityLocator,
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.CONTEXT_TOO_LARGE,
      );
      continue;
    }
    const citationLocatorRefs = citationChunks.map((chunk) => ({
      documentId: chunk.documentId,
      locator: chunk.locator,
    }));
    const level =
      group.segments.length === 1
        ? LEGAL_RULE_SOURCE_PROVISION_LEVELS.ARTICLE
        : group.segments.length === 2
          ? LEGAL_RULE_SOURCE_PROVISION_LEVELS.CLAUSE
          : LEGAL_RULE_SOURCE_PROVISION_LEVELS.POINT;
    const legalRuleId = `src-${sha256Hex(`${input.sourceVersionId}::${input.documentId}::${group.identityLocator}`)}`;
    items.push({
      sourceVersionId: input.sourceVersionId,
      documentId: input.documentId,
      documentTitle: input.documentTitle,
      locator: group.identityLocator,
      legalRuleId,
      title: `${input.documentTitle} - ${group.identityLocator}`.slice(0, 512),
      description,
      citationLocatorRefs,
      level,
    });
  }
  return { items, limitations };
}

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
 * Business purpose: Determine whether a document chunk has an eligible legal effect status for catalog rules.
 * Business rules:
 * - Active law chunks (EFFECTIVE) and unreviewed newly ingested chunks (UNKNOWN) are eligible for citation.
 * - Explicitly repealed (REPEALED) and future/un-enacted (FUTURE) chunks are strictly ineligible.
 * Execution flow:
 * 1. Evaluate chunk legalEffectStatus against allowed active and unreviewed statuses.
 * Failure cases:
 * - None; pure predicate function.
 * Side effects:
 * - Pure predicate evaluation without persistence or I/O side effects.
 */
export function isEligibleLegalChunkStatus(status: LegalEffectStatus): boolean {
  return (
    status === LegalEffectStatus.EFFECTIVE ||
    status === LegalEffectStatus.UNKNOWN
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
    // The versioned graph owns reference resolution for the picker.
    private readonly documentGraph: LegalDocumentGraphService,
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
      const state = reason
        ? S.INELIGIBLE
        : !last
          ? S.NOT_PREPARED
          : last.preparationRun.executionState === AgentExecutionState.QUEUED ||
              last.preparationRun.executionState === AgentExecutionState.RUNNING
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
