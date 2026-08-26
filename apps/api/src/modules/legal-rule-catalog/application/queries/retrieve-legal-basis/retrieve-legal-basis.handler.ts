import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { LegalRetrievalIndexStatus } from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  LEGAL_BASIS_CONTEXT_ROLES,
  LEGAL_BASIS_EFFECTIVE_STATUSES,
  LEGAL_BASIS_RETRIEVAL_LIMITATION_CODES,
  LEGAL_BASIS_RETRIEVAL_VALUES,
  LEGAL_BASIS_RETRIEVABLE_CHUNK_STATUSES,
  LEGAL_BASIS_RETRIEVABLE_SOURCE_EFFECT_STATUSES,
  RETRIEVE_LEGAL_BASIS_TOOL,
  type RetrieveLegalBasisResponse,
} from "@lcsp/contracts/evidence";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";

import { toPrismaLegalRuleLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { RetrieveLegalBasisQuery } from "./retrieve-legal-basis.query.js";

const PROJECTION_RETRY_DELAY_MS = 250;
const PROJECTION_TIMEOUT_MS = 4_000;
const SAFE_MANIFEST_REF = /^[a-z][a-z0-9-]{0,63}:[A-Za-z0-9._-]{1,128}$/;
const SHA_256 = /^sha256:[a-f0-9]{64}$/i;
const CHUNK_REF = /^chunk_[A-Za-z0-9_-]{6,80}$/;

type LegalChunkProjection = {
  id: string;
  locator: string;
  content: string;
  contentSha256: string;
  legalStatus: string;
  hierarchy: unknown;
  sourceDocument: { sourceEffectStatus: string };
};

@QueryHandler(RetrieveLegalBasisQuery)
export class RetrieveLegalBasisHandler implements IQueryHandler<
  RetrieveLegalBasisQuery,
  RetrieveLegalBasisResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: RetrieveLegalBasisQuery,
  ): Promise<RetrieveLegalBasisResponse> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: query.assessmentId },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    try {
      const corpusId = corpusIdFromRef(query.input.corpusVersionId);
      const corpus = await this.withRetry(() =>
        this.prisma.legalCorpusVersion.findFirst({
          where: {
            id: corpusId,
            status: toPrismaLegalRuleLifecycleStatus(
              LEGAL_RULE_LIFECYCLE_STATUSES.approved,
            ),
          },
          select: { id: true },
        }),
      );
      const index = corpus ? await this.resolveValidIndex(corpus.id) : null;
      if (!corpus || !index || !validIndexProvenance(index)) {
        return this.writeAndReturn(
          query,
          this.indexBlockedResponse(query.input.corpusVersionId),
          assessment.id,
          corpus?.id ?? null,
        );
      }

      const requestedChunkIds = await this.resolveChunkIds(query);
      const primary = await this.loadChunks(corpus.id, requestedChunkIds);
      const effectivePrimary = primary.filter(isEffectiveChunk);
      if (effectivePrimary.length === 0) {
        const hasKnownButIneffective = primary.length > 0;
        return this.writeAndReturn(
          query,
          hasKnownButIneffective
            ? this.outOfCoverageResponse(query.input.corpusVersionId, index.id)
            : this.notFoundResponse(query.input.corpusVersionId, index.id),
          assessment.id,
          corpus.id,
        );
      }

      const citations = await this.expandCitations(
        corpus.id,
        effectivePrimary,
        query.input.includeContext,
      );
      const capped = citations.slice(0, RETRIEVE_LEGAL_BASIS_TOOL.maxCitations);
      const resultLimited = citations.length > capped.length;
      const response = this.readyResponse(
        query.input.corpusVersionId,
        index.id,
        capped,
        resultLimited,
      );
      return this.writeAndReturn(query, response, assessment.id, corpus.id);
    } catch {
      return this.writeAndReturn(
        query,
        this.unavailableResponse(query.input.corpusVersionId),
        assessment.id,
        null,
      );
    }
  }

  private async resolveValidIndex(corpusId: string) {
    return this.withRetry(() =>
      this.prisma.legalRetrievalIndex.findFirst({
        where: {
          legalCorpusVersionId: corpusId,
          status: LegalRetrievalIndexStatus.VALID,
          validatedAt: { not: null },
          validationManifestRef: { not: null },
        },
        orderBy: [{ validatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          configHash: true,
          contentHash: true,
          validationManifestRef: true,
        },
      }),
    );
  }

  private async resolveChunkIds(
    query: RetrieveLegalBasisQuery,
  ): Promise<string[]> {
    const direct = query.input.selectors.chunkIds ?? [];
    const ruleIds = query.input.selectors.ruleIds ?? [];
    if (ruleIds.length === 0) return unique(direct);

    const rules = await this.withRetry(() =>
      this.prisma.legalRule.findMany({
        where: {
          legalRuleId: { in: ruleIds },
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        },
        select: { citationLocatorRefs: true },
      }),
    );
    const fromRules = rules.flatMap((rule) =>
      citationChunkIds(rule.citationLocatorRefs),
    );
    return unique([...direct, ...fromRules]);
  }

  private async loadChunks(
    corpusId: string,
    ids: string[],
  ): Promise<LegalChunkProjection[]> {
    if (ids.length === 0) return [];
    return this.withRetry(() =>
      this.prisma.legalDocumentChunk.findMany({
        where: { legalCorpusVersionId: corpusId, id: { in: ids } },
        select: {
          id: true,
          locator: true,
          content: true,
          contentSha256: true,
          legalStatus: true,
          hierarchy: true,
          sourceDocument: { select: { sourceEffectStatus: true } },
        },
      }),
    );
  }

  private async expandCitations(
    corpusId: string,
    primary: LegalChunkProjection[],
    includeContext: boolean,
  ) {
    const roles = primary.map((chunk) => ({
      chunk,
      contextRole: LEGAL_BASIS_CONTEXT_ROLES.primaryMatch,
    }));
    if (!includeContext) return sortCitations(roles);

    const primaryIds = new Set(primary.map(({ id }) => id));
    const parentIds = unique(
      primary.flatMap((chunk) => parentChunkIds(chunk.hierarchy)),
    );
    const relatedIds = unique(
      primary.flatMap((chunk) => relatedChunkIds(chunk.hierarchy)),
    ).filter((id) => !primaryIds.has(id) && !parentIds.includes(id));
    const [parents, references] = await Promise.all([
      this.loadChunks(corpusId, parentIds),
      this.loadChunks(corpusId, relatedIds),
    ]);
    return sortCitations([
      ...roles,
      ...parents.filter(isEffectiveChunk).map((chunk) => ({
        chunk,
        contextRole: LEGAL_BASIS_CONTEXT_ROLES.parentContext,
      })),
      ...references.filter(isEffectiveChunk).map((chunk) => ({
        chunk,
        contextRole: LEGAL_BASIS_CONTEXT_ROLES.referencedContext,
      })),
    ]);
  }

  private readyResponse(
    corpusVersionId: string,
    indexId: string,
    citations: Array<{
      chunk: LegalChunkProjection;
      contextRole: (typeof LEGAL_BASIS_CONTEXT_ROLES)[keyof typeof LEGAL_BASIS_CONTEXT_ROLES];
    }>,
    resultLimited: boolean,
  ): RetrieveLegalBasisResponse {
    const rendered = citations.map(({ chunk, contextRole }) => ({
      chunkId: chunk.id,
      locator: chunk.locator,
      contextRole,
      effectiveStatus: LEGAL_BASIS_EFFECTIVE_STATUSES.effective,
      excerpt: excerpt(chunk.content),
      contentHash: chunk.contentSha256,
    }));
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.retrieveLegalBasis,
      toolVersion: RETRIEVE_LEGAL_BASIS_TOOL.version,
      configHash: RETRIEVE_LEGAL_BASIS_TOOL.configHash,
      correlationId: "",
      artifactVersions: {
        corpusVersionId,
        retrievalIndexId: indexRef(indexId),
      },
      provenanceRef: "",
      coverageState: resultLimited
        ? AGENTIC_TOOL_COVERAGE_STATES.partial
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: rendered.map(({ chunkId }) => citationRef(chunkId)),
      limitations: resultLimited
        ? [
            {
              code: LEGAL_BASIS_RETRIEVAL_LIMITATION_CODES.resultLimitReached,
              affectedScopeRef: `corpus:${corpusVersionId}`,
              reason: "The bounded citation limit was reached.",
              retryable: false,
            },
          ]
        : [],
      result: {
        outcome: LEGAL_BASIS_RETRIEVAL_VALUES.matched,
        citations: rendered,
        nextCursor: null,
      },
    };
  }

  private notFoundResponse(
    corpusVersionId: string,
    indexId: string,
  ): RetrieveLegalBasisResponse {
    return this.emptyResponse(
      AGENTIC_TOOL_STATUSES.ready,
      AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      corpusVersionId,
      indexRef(indexId),
      [],
    );
  }

  private outOfCoverageResponse(
    corpusVersionId: string,
    indexId: string,
  ): RetrieveLegalBasisResponse {
    return this.emptyResponse(
      AGENTIC_TOOL_STATUSES.outOfCoverage,
      AGENTIC_TOOL_COVERAGE_STATES.limited,
      corpusVersionId,
      indexRef(indexId),
      [
        {
          code: LEGAL_BASIS_RETRIEVAL_LIMITATION_CODES.noEffectiveChunkForSelector,
          affectedScopeRef: `corpus:${corpusVersionId}`,
          reason:
            "The requested selector resolves only to non-effective chunks.",
          retryable: false,
        },
      ],
    );
  }

  private indexBlockedResponse(
    corpusVersionId: string,
  ): RetrieveLegalBasisResponse {
    return this.emptyResponse(
      AGENTIC_TOOL_STATUSES.blocked,
      AGENTIC_TOOL_COVERAGE_STATES.limited,
      corpusVersionId,
      null,
      [
        {
          code: LEGAL_BASIS_RETRIEVAL_LIMITATION_CODES.indexValidationFailed,
          affectedScopeRef: `corpus:${corpusVersionId}`,
          reason: "The pinned corpus has no validated retrieval index.",
          retryable: false,
        },
      ],
    );
  }

  private unavailableResponse(
    corpusVersionId: string,
  ): RetrieveLegalBasisResponse {
    return this.emptyResponse(
      AGENTIC_TOOL_STATUSES.failed,
      AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      corpusVersionId,
      null,
      [
        {
          code: LEGAL_BASIS_RETRIEVAL_LIMITATION_CODES.retrievalUnavailable,
          affectedScopeRef: `corpus:${corpusVersionId}`,
          reason: "The retrieval projection is unavailable after retry.",
          retryable: false,
        },
      ],
    );
  }

  private emptyResponse(
    status: RetrieveLegalBasisResponse["status"],
    coverageState: RetrieveLegalBasisResponse["coverageState"],
    corpusVersionId: string,
    retrievalIndexId: string | null,
    limitations: RetrieveLegalBasisResponse["limitations"],
  ): RetrieveLegalBasisResponse {
    return {
      status,
      toolName: AGENTIC_TOOL_NAMES.retrieveLegalBasis,
      toolVersion: RETRIEVE_LEGAL_BASIS_TOOL.version,
      configHash: RETRIEVE_LEGAL_BASIS_TOOL.configHash,
      correlationId: "",
      artifactVersions: { corpusVersionId, retrievalIndexId },
      provenanceRef: "",
      coverageState,
      evidenceRefs: [],
      limitations,
      result: {
        outcome: LEGAL_BASIS_RETRIEVAL_VALUES.notFound,
        citations: [],
        nextCursor: null,
      },
    };
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.withTimeout(operation());
    } catch {
      await new Promise((resolve) =>
        setTimeout(resolve, PROJECTION_RETRY_DELAY_MS),
      );
      return this.withTimeout(operation());
    }
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("legal-basis-retrieval-timeout")),
            PROJECTION_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async writeAndReturn(
    query: RetrieveLegalBasisQuery,
    response: RetrieveLegalBasisResponse,
    assessmentId: string,
    corpusId: string | null,
  ): Promise<RetrieveLegalBasisResponse> {
    const hydrated = {
      ...response,
      correlationId: query.correlationId,
      provenanceRef: `provenance:legal-basis:${query.correlationId}`,
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.legalBasisRetrieved,
      actorId: query.actorId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      correlationId: query.correlationId,
      decision:
        hydrated.status === AGENTIC_TOOL_STATUSES.ready
          ? AUDIT_DECISIONS.allow
          : AUDIT_DECISIONS.deny,
      result: hydrated.status,
      payload: {
        toolName: hydrated.toolName,
        corpusVersionRef: corpusId ? corpusRef(corpusId) : null,
        retrievalIndexRef: hydrated.artifactVersions.retrievalIndexId,
        selectorHash: safeHash(query.input.selectors),
        includeContext: query.input.includeContext,
        selectedCitationRefs: hydrated.evidenceRefs,
        outputHash: safeHash(hydrated),
        limitationCodes: hydrated.limitations.map(({ code }) => code),
      },
    });
    return hydrated;
  }
}

function corpusIdFromRef(value: string): string {
  return value.slice("corpus_".length);
}

function corpusRef(id: string): string {
  return `corpus_${id}`;
}

function indexRef(id: string): string {
  return `index_${id}`;
}

function citationRef(chunkId: string): string {
  return `citation:${chunkId}`;
}

function excerpt(content: string): string {
  return Array.from(content)
    .slice(0, RETRIEVE_LEGAL_BASIS_TOOL.maxExcerptCharacters)
    .join("");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isEffectiveChunk(chunk: LegalChunkProjection): boolean {
  return (
    Object.values(LEGAL_BASIS_RETRIEVABLE_CHUNK_STATUSES).includes(
      chunk.legalStatus as (typeof LEGAL_BASIS_RETRIEVABLE_CHUNK_STATUSES)[keyof typeof LEGAL_BASIS_RETRIEVABLE_CHUNK_STATUSES],
    ) &&
    Object.values(LEGAL_BASIS_RETRIEVABLE_SOURCE_EFFECT_STATUSES).includes(
      chunk.sourceDocument
        .sourceEffectStatus as (typeof LEGAL_BASIS_RETRIEVABLE_SOURCE_EFFECT_STATUSES)[keyof typeof LEGAL_BASIS_RETRIEVABLE_SOURCE_EFFECT_STATUSES],
    )
  );
}

function sortCitations<
  T extends { chunk: LegalChunkProjection; contextRole: string },
>(citations: T[]): T[] {
  const roleRank = {
    [LEGAL_BASIS_CONTEXT_ROLES.primaryMatch]: 0,
    [LEGAL_BASIS_CONTEXT_ROLES.parentContext]: 1,
    [LEGAL_BASIS_CONTEXT_ROLES.referencedContext]: 2,
  } as const;
  return [...citations].sort(
    (left, right) =>
      (roleRank[left.contextRole as keyof typeof roleRank] ?? 99) -
        (roleRank[right.contextRole as keyof typeof roleRank] ?? 99) ||
      left.chunk.locator.localeCompare(right.chunk.locator) ||
      left.chunk.id.localeCompare(right.chunk.id),
  );
}

function citationChunkIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const id = (entry as { id?: unknown }).id;
    return typeof id === "string" && CHUNK_REF.test(id) ? [id] : [];
  });
}

function parentChunkIds(hierarchy: unknown): string[] {
  if (!hierarchy || typeof hierarchy !== "object" || Array.isArray(hierarchy))
    return [];
  const value = hierarchy as {
    parentChunkId?: unknown;
    parent_chunk_id?: unknown;
  };
  const id = value.parentChunkId ?? value.parent_chunk_id;
  return typeof id === "string" && CHUNK_REF.test(id) ? [id] : [];
}

function relatedChunkIds(hierarchy: unknown): string[] {
  if (!hierarchy || typeof hierarchy !== "object" || Array.isArray(hierarchy))
    return [];
  const value = hierarchy as {
    outgoingRefIds?: unknown;
    outgoing_ref_ids?: unknown;
    incomingRefIds?: unknown;
    incoming_ref_ids?: unknown;
  };
  return [
    ...stableIds(value.outgoingRefIds),
    ...stableIds(value.outgoing_ref_ids),
    ...stableIds(value.incomingRefIds),
    ...stableIds(value.incoming_ref_ids),
  ];
}

function stableIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (id): id is string => typeof id === "string" && CHUNK_REF.test(id),
      )
    : [];
}

function safeHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function validIndexProvenance(index: {
  configHash: string;
  contentHash: string;
  validationManifestRef: string | null;
}): index is {
  configHash: string;
  contentHash: string;
  validationManifestRef: string;
} {
  return (
    SHA_256.test(index.configHash) &&
    SHA_256.test(index.contentHash) &&
    typeof index.validationManifestRef === "string" &&
    SAFE_MANIFEST_REF.test(index.validationManifestRef)
  );
}
