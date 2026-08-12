import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  ClassificationGuardrailStatus,
  EvidenceAcceptanceStatus,
  LegalRuleMatchGuardrailStatus,
  OverallCoverageStatus,
} from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  GAP_MATRIX_ROW_STATUSES,
  GAP_REMEDIATION_LIMITATION_CODES,
  GAP_REMEDIATION_TEMPLATE_IDS,
  PROPOSE_GAP_REMEDIATION_TOOL,
  type ProposeGapRemediationResponse,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { ProposeGapRemediationQuery } from "./propose-gap-remediation.query.js";

const GAP_ROW_PREFIX = "gap-row:";
const ROW_KEYS = {
  citationBasis: "citation_basis",
} as const;

type MatchProjection = {
  citationAllowlist: unknown;
  overallCoverageStatus: OverallCoverageStatus;
  guardrailStatus: LegalRuleMatchGuardrailStatus;
};

type RowEvaluation = {
  status: (typeof GAP_MATRIX_ROW_STATUSES)[keyof typeof GAP_MATRIX_ROW_STATUSES];
  evidenceRefs: string[];
};

@QueryHandler(ProposeGapRemediationQuery)
export class ProposeGapRemediationHandler implements IQueryHandler<
  ProposeGapRemediationQuery,
  ProposeGapRemediationResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: ProposeGapRemediationQuery,
  ): Promise<ProposeGapRemediationResponse> {
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

    const parsed = parseRowRef(query.input.rowRef);
    if (!parsed) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        query.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const classification = await this.prisma.classificationResult.findFirst({
      where: {
        id: parsed.classificationId,
        assessmentId: assessment.id,
        organizationId: query.organizationId,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      select: {
        id: true,
        legalRuleMatchId: true,
        classificationData: true,
        guardrailStatus: true,
      },
    });

    if (
      !classification?.legalRuleMatchId ||
      classification.guardrailStatus === ClassificationGuardrailStatus.BLOCKED
    ) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          GAP_REMEDIATION_LIMITATION_CODES.rowUnavailable,
          query.input.rowRef,
          "The pinned gap row cannot be resolved to a remediation-safe classification state.",
        ),
      );
    }

    const ruleMatch = await this.prisma.legalRuleMatch.findFirst({
      where: {
        id: classification.legalRuleMatchId,
        assessmentId: assessment.id,
        organizationId: query.organizationId,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      select: {
        citationAllowlist: true,
        overallCoverageStatus: true,
        guardrailStatus: true,
      },
    });

    if (
      !ruleMatch ||
      ruleMatch.guardrailStatus === LegalRuleMatchGuardrailStatus.BLOCKED
    ) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          GAP_REMEDIATION_LIMITATION_CODES.rowUnavailable,
          query.input.rowRef,
          "The pinned gap row lost its accepted legal rule match context.",
        ),
      );
    }

    const row = evaluateRow(
      parsed.rowKey,
      classification.classificationData,
      ruleMatch,
    );

    if (row.status === GAP_MATRIX_ROW_STATUSES.satisfied) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.sufficient,
          GAP_REMEDIATION_LIMITATION_CODES.staleSatisfiedRow,
          query.input.rowRef,
          "The pinned gap row is already satisfied, so remediation cannot self-close it.",
        ),
      );
    }

    if (!isTemplateAllowed(row.status, query.input.templateId)) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.blocked,
          coverageStateForRow(row.status),
          GAP_REMEDIATION_LIMITATION_CODES.templateNotAllowed,
          query.input.rowRef,
          "The selected remediation template is not allowed for the current gap row state.",
        ),
      );
    }

    return this.writeAndReturn(query, assessment.id, {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.proposeGapRemediation,
      toolVersion: PROPOSE_GAP_REMEDIATION_TOOL.version,
      configHash: PROPOSE_GAP_REMEDIATION_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: { gapRowRef: query.input.rowRef },
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: coverageStateForRow(row.status),
      evidenceRefs: row.evidenceRefs,
      limitations: [],
      result: {
        proposalRef: buildProposalRef(
          query.input.rowRef,
          query.input.templateId,
        ),
        rowRef: query.input.rowRef,
        templateId: query.input.templateId,
        requiredIndependentValidation: true,
      },
    });
  }

  private async writeAndReturn(
    query: ProposeGapRemediationQuery,
    assessmentId: string,
    response: ProposeGapRemediationResponse,
  ): Promise<ProposeGapRemediationResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.gapRemediationProposed,
      actorId: query.actorId,
      organizationId: query.organizationId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        toolName: response.toolName,
        gapRowRef: response.artifactVersions.gapRowRef,
        templateId: query.input.templateId,
        proposalRef: response.result.proposalRef,
        outputHash: safeHash(response.result),
        evidenceRefHash: safeHash(response.evidenceRefs),
      },
    });
    return response;
  }
}

function evaluateRow(
  rowKey: string,
  classificationData: unknown,
  ruleMatch: MatchProjection,
): RowEvaluation {
  const data = asRecord(classificationData);
  const fieldValue =
    rowKey === "applicability_assessment"
      ? (data?.applicability_assessment ?? data?.system_type)
      : data?.[rowKey];
  const coverageLimited =
    ruleMatch.overallCoverageStatus !== OverallCoverageStatus.COMPLETE_CITATION;

  if (coverageLimited) {
    return { status: GAP_MATRIX_ROW_STATUSES.outOfCoverage, evidenceRefs: [] };
  }

  if (rowKey === ROW_KEYS.citationBasis) {
    if (!Array.isArray(fieldValue)) {
      return {
        status:
          fieldValue == null
            ? GAP_MATRIX_ROW_STATUSES.missing
            : GAP_MATRIX_ROW_STATUSES.unknown,
        evidenceRefs: [],
      };
    }
    const refs = fieldValue
      .filter((value): value is string => typeof value === "string")
      .sort();
    if (refs.length === 0) {
      return { status: GAP_MATRIX_ROW_STATUSES.missing, evidenceRefs: [] };
    }
    const allowlist = citationRefs(ruleMatch.citationAllowlist);
    if (refs.some((ref) => !allowlist.has(ref))) {
      return { status: GAP_MATRIX_ROW_STATUSES.contradicted, evidenceRefs: [] };
    }
    return { status: GAP_MATRIX_ROW_STATUSES.satisfied, evidenceRefs: refs };
  }

  if (typeof fieldValue === "string" && fieldValue.trim().length > 0) {
    return { status: GAP_MATRIX_ROW_STATUSES.missing, evidenceRefs: [] };
  }

  if (fieldValue == null) {
    return { status: GAP_MATRIX_ROW_STATUSES.missing, evidenceRefs: [] };
  }

  return { status: GAP_MATRIX_ROW_STATUSES.unknown, evidenceRefs: [] };
}

function isTemplateAllowed(
  rowStatus: RowEvaluation["status"],
  templateId: ProposeGapRemediationQuery["input"]["templateId"],
): boolean {
  switch (rowStatus) {
    case GAP_MATRIX_ROW_STATUSES.missing:
      return templateId === GAP_REMEDIATION_TEMPLATE_IDS.collectEvidence;
    case GAP_MATRIX_ROW_STATUSES.contradicted:
      return templateId === GAP_REMEDIATION_TEMPLATE_IDS.resolveConflict;
    case GAP_MATRIX_ROW_STATUSES.outOfCoverage:
      return templateId === GAP_REMEDIATION_TEMPLATE_IDS.expandCoverage;
    case GAP_MATRIX_ROW_STATUSES.unknown:
      return templateId === GAP_REMEDIATION_TEMPLATE_IDS.collectEvidence;
    default:
      return false;
  }
}

function coverageStateForRow(
  rowStatus: RowEvaluation["status"],
): ProposeGapRemediationResponse["coverageState"] {
  switch (rowStatus) {
    case GAP_MATRIX_ROW_STATUSES.outOfCoverage:
      return AGENTIC_TOOL_COVERAGE_STATES.limited;
    case GAP_MATRIX_ROW_STATUSES.unknown:
      return AGENTIC_TOOL_COVERAGE_STATES.partial;
    default:
      return AGENTIC_TOOL_COVERAGE_STATES.sufficient;
  }
}

function terminalResponse(
  query: ProposeGapRemediationQuery,
  status: ProposeGapRemediationResponse["status"],
  coverageState: ProposeGapRemediationResponse["coverageState"],
  code: (typeof GAP_REMEDIATION_LIMITATION_CODES)[keyof typeof GAP_REMEDIATION_LIMITATION_CODES],
  affectedScopeRef: string | null,
  reason: string,
): ProposeGapRemediationResponse {
  return {
    status,
    toolName: AGENTIC_TOOL_NAMES.proposeGapRemediation,
    toolVersion: PROPOSE_GAP_REMEDIATION_TOOL.version,
    configHash: PROPOSE_GAP_REMEDIATION_TOOL.configHash,
    correlationId: query.correlationId,
    artifactVersions: { gapRowRef: query.input.rowRef },
    provenanceRef: provenanceRef(query.correlationId),
    coverageState,
    evidenceRefs: [],
    limitations: [
      {
        code,
        affectedScopeRef,
        reason,
        retryable: false,
      },
    ],
    result: {
      proposalRef: buildProposalRef(query.input.rowRef, query.input.templateId),
      rowRef: query.input.rowRef,
      templateId: query.input.templateId,
      requiredIndependentValidation: true,
    },
  };
}

function parseRowRef(
  rowRef: string,
): { classificationId: string; rowKey: string } | null {
  if (!rowRef.startsWith(GAP_ROW_PREFIX)) return null;
  const parts = rowRef.slice(GAP_ROW_PREFIX.length).split(":");
  if (parts.length < 2) return null;
  const classificationId = parts.shift();
  const rowKey = normalizeRowKey(parts.join(":"));
  return classificationId && rowKey ? { classificationId, rowKey } : null;
}

function normalizeRowKey(rowKey: string): string {
  if (rowKey === "system_type") {
    return "applicability_assessment";
  }
  return rowKey;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function citationRefs(value: unknown): Set<string> {
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [],
  );
}

function buildProposalRef(rowRef: string, templateId: string): string {
  return `remediation-proposal:${safeHash({ rowRef, templateId }).slice(0, 16)}`;
}

function provenanceRef(correlationId: string): string {
  return `gap-remediation:${safeHash(correlationId).slice(0, 24)}`;
}

function safeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
