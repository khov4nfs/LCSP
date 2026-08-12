import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  EvidenceAcceptanceStatus,
  LegalRuleLifecycleStatus,
  LegalRuleMatchGuardrailStatus,
} from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  CITATION_SET_VALIDITY,
  VALIDATE_CITATION_SET_TOOL,
  type CitationSetValidity,
  type ValidateCitationSetResponse,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { ValidateCitationSetQuery } from "./validate-citation-set.query.js";

const RETRIEVABLE_LEGAL_STATUSES = new Set(["ACTIVE", "AMENDED"]);
const RETRIEVABLE_SOURCE_EFFECTS = new Set([
  "CON_HIEU_LUC",
  "HET_HIEU_LUC_MOT_PHAN",
]);

@QueryHandler(ValidateCitationSetQuery)
export class ValidateCitationSetHandler implements IQueryHandler<
  ValidateCitationSetQuery,
  ValidateCitationSetResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: ValidateCitationSetQuery,
  ): Promise<ValidateCitationSetResponse> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: query.assessmentId, organizationId: query.organizationId },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const corpusId = idFromRef(query.input.corpusVersionId, "corpus_");
    const matchId = idFromRef(
      query.input.legalRuleMatchId,
      "legal_rule_match_",
    );
    const [corpus, match] = await Promise.all([
      this.prisma.legalCorpusVersion.findFirst({
        where: { id: corpusId, status: LegalRuleLifecycleStatus.APPROVED },
        select: { id: true },
      }),
      this.prisma.legalRuleMatch.findFirst({
        where: {
          id: matchId,
          assessmentId: assessment.id,
          organizationId: query.organizationId,
          corpusVersionId: corpusId,
          status: EvidenceAcceptanceStatus.ACCEPTED,
          guardrailStatus: LegalRuleMatchGuardrailStatus.PASSED,
        },
        select: { id: true, citationAllowlist: true },
      }),
    ]);

    if (!corpus || !match) {
      return this.writeAndReturn(
        query,
        assessment.id,
        this.blockedResponse(query),
      );
    }

    const allowlist = citationRefs(match.citationAllowlist);
    const chunkIds = query.input.citationRefs.map(chunkIdFromCitationRef);
    const chunks = await this.prisma.legalDocumentChunk.findMany({
      where: { legalCorpusVersionId: corpus.id, id: { in: chunkIds } },
      select: {
        id: true,
        legalStatus: true,
        sourceDocument: { select: { sourceEffectStatus: true } },
      },
    });
    const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const items = query.input.citationRefs
      .slice()
      .sort()
      .map((citationRef) => ({
        citationRef,
        ...validateCitation(
          citationRef,
          allowlist,
          chunksById.get(chunkIdFromCitationRef(citationRef)),
        ),
      }));
    const response: ValidateCitationSetResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.validateCitationSet,
      toolVersion: VALIDATE_CITATION_SET_TOOL.version,
      configHash: VALIDATE_CITATION_SET_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: {
        corpusVersionId: query.input.corpusVersionId,
        legalRuleMatchId: query.input.legalRuleMatchId,
      },
      provenanceRef: `provenance:citation-validation:${query.correlationId}`,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: items.map(({ citationRef }) => citationRef),
      limitations: [],
      result: {
        valid: items.every(
          ({ validity }) => validity === CITATION_SET_VALIDITY.valid,
        ),
        items,
        validatedAtVersion: query.input.corpusVersionId,
      },
    };
    return this.writeAndReturn(query, assessment.id, response);
  }

  private blockedResponse(
    query: ValidateCitationSetQuery,
  ): ValidateCitationSetResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      toolName: AGENTIC_TOOL_NAMES.validateCitationSet,
      toolVersion: VALIDATE_CITATION_SET_TOOL.version,
      configHash: VALIDATE_CITATION_SET_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: {
        corpusVersionId: query.input.corpusVersionId,
        legalRuleMatchId: query.input.legalRuleMatchId,
      },
      provenanceRef: `provenance:citation-validation:${query.correlationId}`,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      evidenceRefs: [],
      limitations: [
        {
          code: "MATCH_OR_CORPUS_UNAVAILABLE",
          affectedScopeRef: query.input.legalRuleMatchId,
          reason:
            "The caller does not own an accepted, pinned rule match for the approved corpus.",
          retryable: false,
        },
      ],
      result: {
        valid: false,
        items: [],
        validatedAtVersion: query.input.corpusVersionId,
      },
    };
  }

  private async writeAndReturn(
    query: ValidateCitationSetQuery,
    assessmentId: string,
    response: ValidateCitationSetResponse,
  ): Promise<ValidateCitationSetResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.citationSetValidated,
      actorId: query.actorId,
      organizationId: query.organizationId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      correlationId: query.correlationId,
      policyId: query.policyId,
      policyVersion: query.policyVersion,
      decision:
        response.status === AGENTIC_TOOL_STATUSES.ready
          ? AUDIT_DECISIONS.allow
          : AUDIT_DECISIONS.deny,
      result: response.status,
      payload: {
        toolName: response.toolName,
        corpusVersionRef: response.artifactVersions.corpusVersionId,
        legalRuleMatchRef: response.artifactVersions.legalRuleMatchId,
        citationRefHash: safeHash(query.input.citationRefs),
        outputHash: safeHash(response),
        limitationCodes: response.limitations.map(({ code }) => code),
      },
    });
    return response;
  }
}

function validateCitation(
  citationRef: string,
  allowlist: Set<string>,
  chunk:
    | { legalStatus: string; sourceDocument: { sourceEffectStatus: string } }
    | undefined,
): { validity: CitationSetValidity; reasonCode: string | null } {
  if (!chunk)
    return {
      validity: CITATION_SET_VALIDITY.absent,
      reasonCode: "CITATION_ABSENT",
    };
  if (
    !RETRIEVABLE_LEGAL_STATUSES.has(chunk.legalStatus) ||
    !RETRIEVABLE_SOURCE_EFFECTS.has(chunk.sourceDocument.sourceEffectStatus)
  ) {
    return {
      validity: CITATION_SET_VALIDITY.repealed,
      reasonCode: "CITATION_REPEALED_OR_INEFFECTIVE",
    };
  }
  if (!allowlist.has(citationRef))
    return {
      validity: CITATION_SET_VALIDITY.outOfAllowlist,
      reasonCode: "CITATION_OUT_OF_ALLOWLIST",
    };
  return { validity: CITATION_SET_VALIDITY.valid, reasonCode: null };
}

function citationRefs(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.filter((item): item is string => typeof item === "string"),
  );
}

function idFromRef(ref: string, prefix: string): string {
  return ref.slice(prefix.length);
}

function chunkIdFromCitationRef(ref: string): string {
  return ref.slice("citation:".length);
}

function safeHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
