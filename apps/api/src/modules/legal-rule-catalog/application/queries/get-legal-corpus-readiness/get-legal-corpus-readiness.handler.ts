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
  GET_LEGAL_CORPUS_READINESS_TOOL,
  LEGAL_CORPUS_READINESS_LIMITATION_CODES,
  LEGAL_CORPUS_READINESS_REQUIREMENTS,
  LEGAL_CORPUS_READINESS_VALUES,
  type GetLegalCorpusReadinessResponse,
} from "@lcsp/contracts/evidence";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";

import { toPrismaLegalRuleLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GetLegalCorpusReadinessQuery } from "./get-legal-corpus-readiness.query.js";

const PROJECTION_RETRY_DELAY_MS = 200;
const PROJECTION_TIMEOUT_MS = 2_000;
const SAFE_MANIFEST_REF = /^[a-z][a-z0-9-]{0,63}:[A-Za-z0-9._-]{1,128}$/;
const SHA_256 = /^sha256:[a-f0-9]{64}$/i;

@QueryHandler(GetLegalCorpusReadinessQuery)
export class GetLegalCorpusReadinessHandler implements IQueryHandler<
  GetLegalCorpusReadinessQuery,
  GetLegalCorpusReadinessResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetLegalCorpusReadinessQuery,
  ): Promise<GetLegalCorpusReadinessResponse> {
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
      const corpus = await this.withProjectionRetry(() =>
        this.resolveCorpus(query),
      );
      if (!corpus) {
        return this.writeAndReturn(
          query,
          this.blockedCorpusResponse(query.effectiveDate),
          assessment.id,
          null,
        );
      }

      const index = await this.resolveValidIndex(corpus.id);
      if (!index || !validIndexProvenance(index)) {
        return this.writeAndReturn(
          query,
          this.blockedIndexResponse(query.effectiveDate, corpus.id),
          assessment.id,
          corpus.id,
        );
      }

      const corpusVersionId = corpusRef(corpus.id);
      const indexVersionId = indexRef(index.id);
      const response: GetLegalCorpusReadinessResponse = {
        status: AGENTIC_TOOL_STATUSES.ready,
        toolName: AGENTIC_TOOL_NAMES.getLegalCorpusReadiness,
        toolVersion: GET_LEGAL_CORPUS_READINESS_TOOL.version,
        configHash: GET_LEGAL_CORPUS_READINESS_TOOL.configHash,
        correlationId: query.correlationId,
        artifactVersions: { corpusVersionId, retrievalIndexId: indexVersionId },
        provenanceRef: provenanceRef(query.correlationId),
        coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
        evidenceRefs: [
          `corpus:${corpusVersionId}`,
          `retrieval-index:${indexVersionId}`,
          index.validationManifestRef,
        ],
        limitations: [],
        result: {
          corpusVersionId,
          indexVersionId,
          readiness: LEGAL_CORPUS_READINESS_VALUES.ready,
          effectiveDate: formatDate(query.effectiveDate),
          missingRequirements: [],
        },
      };
      return this.writeAndReturn(query, response, assessment.id, corpus.id);
    } catch {
      return this.writeAndReturn(
        query,
        this.projectionUnavailableResponse(query.effectiveDate),
        assessment.id,
        null,
      );
    }
  }

  private async resolveCorpus(query: GetLegalCorpusReadinessQuery) {
    const where = query.pinnedCorpusVersionId
      ? {
          id: query.pinnedCorpusVersionId,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        }
      : {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
          approvedAt: { lte: query.effectiveDate },
        };
    return this.prisma.legalCorpusVersion.findFirst({
      where,
      orderBy: { approvedAt: "desc" },
      select: { id: true },
    });
  }

  private async resolveValidIndex(corpusVersionId: string) {
    return this.withProjectionRetry(() =>
      this.prisma.legalRetrievalIndex.findFirst({
        where: {
          legalCorpusVersionId: corpusVersionId,
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

  private async withProjectionRetry<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
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
            () => reject(new Error("projection-timeout")),
            PROJECTION_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private blockedCorpusResponse(
    effectiveDate: Date,
  ): GetLegalCorpusReadinessResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      toolName: AGENTIC_TOOL_NAMES.getLegalCorpusReadiness,
      toolVersion: GET_LEGAL_CORPUS_READINESS_TOOL.version,
      configHash: GET_LEGAL_CORPUS_READINESS_TOOL.configHash,
      correlationId: "",
      artifactVersions: { corpusVersionId: null, retrievalIndexId: null },
      provenanceRef: "",
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      evidenceRefs: [],
      limitations: [
        {
          code: LEGAL_CORPUS_READINESS_LIMITATION_CODES.corpusUnavailable,
          affectedScopeRef: null,
          reason:
            "No approved corpus is available for the requested effective date.",
          retryable: false,
        },
      ],
      result: {
        corpusVersionId: null,
        indexVersionId: null,
        readiness: LEGAL_CORPUS_READINESS_VALUES.corpusUnavailable,
        effectiveDate: formatDate(effectiveDate),
        missingRequirements: [
          LEGAL_CORPUS_READINESS_REQUIREMENTS.approvedCorpus,
        ],
      },
    };
  }

  private blockedIndexResponse(
    effectiveDate: Date,
    corpusId: string,
  ): GetLegalCorpusReadinessResponse {
    const corpusVersionId = corpusRef(corpusId);
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      toolName: AGENTIC_TOOL_NAMES.getLegalCorpusReadiness,
      toolVersion: GET_LEGAL_CORPUS_READINESS_TOOL.version,
      configHash: GET_LEGAL_CORPUS_READINESS_TOOL.configHash,
      correlationId: "",
      artifactVersions: { corpusVersionId, retrievalIndexId: null },
      provenanceRef: "",
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.limited,
      evidenceRefs: [`corpus:${corpusVersionId}`],
      limitations: [
        {
          code: LEGAL_CORPUS_READINESS_LIMITATION_CODES.indexValidationFailed,
          affectedScopeRef: `corpus:${corpusVersionId}`,
          reason: "The corpus has no validated retrieval index.",
          retryable: false,
        },
      ],
      result: {
        corpusVersionId,
        indexVersionId: null,
        readiness: LEGAL_CORPUS_READINESS_VALUES.indexInvalid,
        effectiveDate: formatDate(effectiveDate),
        missingRequirements: [
          LEGAL_CORPUS_READINESS_REQUIREMENTS.validRetrievalIndex,
        ],
      },
    };
  }

  private projectionUnavailableResponse(
    effectiveDate: Date,
  ): GetLegalCorpusReadinessResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.failed,
      toolName: AGENTIC_TOOL_NAMES.getLegalCorpusReadiness,
      toolVersion: GET_LEGAL_CORPUS_READINESS_TOOL.version,
      configHash: GET_LEGAL_CORPUS_READINESS_TOOL.configHash,
      correlationId: "",
      artifactVersions: { corpusVersionId: null, retrievalIndexId: null },
      provenanceRef: "",
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      evidenceRefs: [],
      limitations: [
        {
          code: LEGAL_CORPUS_READINESS_LIMITATION_CODES.projectionUnavailable,
          affectedScopeRef: null,
          reason: "The corpus readiness projection is unavailable after retry.",
          retryable: false,
        },
      ],
      result: {
        corpusVersionId: null,
        indexVersionId: null,
        readiness: LEGAL_CORPUS_READINESS_VALUES.indexInvalid,
        effectiveDate: formatDate(effectiveDate),
        missingRequirements: [
          LEGAL_CORPUS_READINESS_REQUIREMENTS.validRetrievalIndex,
        ],
      },
    };
  }

  private async writeAndReturn(
    query: GetLegalCorpusReadinessQuery,
    response: GetLegalCorpusReadinessResponse,
    assessmentId: string,
    corpusId: string | null,
  ): Promise<GetLegalCorpusReadinessResponse> {
    const hydrated = {
      ...response,
      correlationId: query.correlationId,
      provenanceRef: provenanceRef(query.correlationId),
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.legalCorpusReadinessRead,
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
        retrievalIndexRef: hydrated.result.indexVersionId,
        requestHash: safeHash({
          effectiveDate: formatDate(query.effectiveDate),
          pinnedCorpusVersionId: query.pinnedCorpusVersionId
            ? corpusRef(query.pinnedCorpusVersionId)
            : null,
        }),
        outputHash: safeHash(hydrated),
        limitationCodes: hydrated.limitations.map(({ code }) => code),
      },
    });
    return hydrated;
  }
}

function corpusRef(id: string): string {
  return `corpus_${id}`;
}

function indexRef(id: string): string {
  return `index_${id}`;
}

function provenanceRef(correlationId: string): string {
  return `provenance:legal-corpus-readiness:${correlationId}`;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function safeHash(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
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
