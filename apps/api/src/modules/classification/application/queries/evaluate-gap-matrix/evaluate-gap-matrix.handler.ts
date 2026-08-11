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
  EVALUATE_GAP_MATRIX_TOOL,
  GAP_MATRIX_LIMITATION_CODES,
  GAP_MATRIX_RATIONALE_CODES,
  GAP_MATRIX_RESOLVER_TYPES,
  GAP_MATRIX_ROW_STATUSES,
  type EvaluateGapMatrixResponse,
  type GapMatrixLimitationCode,
  type GapMatrixRationaleCode,
  type GapMatrixResolverType,
  type GapMatrixRowStatus,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { EvaluateGapMatrixQuery } from "./evaluate-gap-matrix.query.js";

const MATRIX_REF_PREFIX = "matrix:";
const ROW_KEYS = {
  systemType: "system_type",
  riskLevel: "risk_level",
  citationBasis: "citation_basis",
} as const;

type ClassificationProjection = {
  id: string;
  legalRuleMatchId: string | null;
  verifiedProfileId: string | null;
  classificationData: unknown;
  guardrailStatus: ClassificationGuardrailStatus;
  blockedReason: string | null;
};

type LegalRuleMatchProjection = {
  id: string;
  verifiedProfileId: string;
  citationAllowlist: unknown;
  overallCoverageStatus: OverallCoverageStatus;
  guardrailStatus: LegalRuleMatchGuardrailStatus;
  blockedReason: string | null;
};

type GapRow = EvaluateGapMatrixResponse["result"]["rows"][number];

@QueryHandler(EvaluateGapMatrixQuery)
export class EvaluateGapMatrixHandler implements IQueryHandler<
  EvaluateGapMatrixQuery,
  EvaluateGapMatrixResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: EvaluateGapMatrixQuery,
  ): Promise<EvaluateGapMatrixResponse> {
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

    const classificationResultId = idFromRef(
      query.input.matrixRef,
      MATRIX_REF_PREFIX,
    );
    const classification = await this.prisma.classificationResult.findFirst({
      where: {
        id: classificationResultId,
        assessmentId: assessment.id,
        organizationId: query.organizationId,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      select: {
        id: true,
        legalRuleMatchId: true,
        verifiedProfileId: true,
        classificationData: true,
        guardrailStatus: true,
        blockedReason: true,
      },
    });

    if (!classification?.legalRuleMatchId) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          GAP_MATRIX_LIMITATION_CODES.matrixUnavailable,
          query.input.matrixRef,
          "The pinned matrix cannot be resolved to an accepted classification result.",
        ),
      );
    }

    if (
      classification.guardrailStatus === ClassificationGuardrailStatus.BLOCKED
    ) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          GAP_MATRIX_LIMITATION_CODES.classificationBlocked,
          query.input.matrixRef,
          classification.blockedReason ??
            "The classification result guardrail blocks gap evaluation.",
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
        id: true,
        verifiedProfileId: true,
        citationAllowlist: true,
        overallCoverageStatus: true,
        guardrailStatus: true,
        blockedReason: true,
      },
    });

    if (!ruleMatch) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          GAP_MATRIX_LIMITATION_CODES.matrixUnavailable,
          query.input.matrixRef,
          "The classification matrix lost its accepted legal rule match reference.",
        ),
      );
    }

    if (ruleMatch.guardrailStatus === LegalRuleMatchGuardrailStatus.BLOCKED) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.conflict,
          AGENTIC_TOOL_COVERAGE_STATES.limited,
          GAP_MATRIX_LIMITATION_CODES.legalMatchBlocked,
          `rule-match:${ruleMatch.id}`,
          ruleMatch.blockedReason ??
            "The accepted legal rule match guardrail blocks gap evaluation.",
        ),
      );
    }

    const allowlist = citationRefs(ruleMatch.citationAllowlist);
    const supportedEvidenceRefs = query.input.evidenceRefs
      .filter((ref) => allowlist.has(ref))
      .sort();
    const contradictedEvidenceRefs = query.input.evidenceRefs
      .filter((ref) => !allowlist.has(ref))
      .sort();
    const classificationData = asRecord(classification.classificationData);
    const coverageLimited =
      ruleMatch.overallCoverageStatus !==
      OverallCoverageStatus.COMPLETE_CITATION;
    const rows = buildRows({
      classification,
      classificationData,
      ruleMatch,
      coverageLimited,
      supportedEvidenceRefs,
      contradictedEvidenceRefs,
    });
    const coverageState = coverageLimited
      ? AGENTIC_TOOL_COVERAGE_STATES.partial
      : AGENTIC_TOOL_COVERAGE_STATES.sufficient;

    return this.writeAndReturn(query, assessment.id, {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.evaluateGapMatrix,
      toolVersion: EVALUATE_GAP_MATRIX_TOOL.version,
      configHash: EVALUATE_GAP_MATRIX_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: { matrixRef: query.input.matrixRef },
      provenanceRef: provenanceRef(query.correlationId),
      coverageState,
      evidenceRefs: query.input.evidenceRefs.slice().sort(),
      limitations: [],
      result: { rows },
    });
  }

  private async writeAndReturn(
    query: EvaluateGapMatrixQuery,
    assessmentId: string,
    response: EvaluateGapMatrixResponse,
  ): Promise<EvaluateGapMatrixResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.gapMatrixEvaluated,
      actorId: query.actorId,
      organizationId: query.organizationId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        toolName: response.toolName,
        matrixRef: response.artifactVersions.matrixRef,
        outputHash: safeHash(response.result),
        evidenceRefHash: safeHash(query.input.evidenceRefs.slice().sort()),
        rowCount: response.result.rows.length,
        status: response.status,
        coverageState: response.coverageState,
      },
    });
    return response;
  }
}

function buildRows(input: {
  classification: ClassificationProjection;
  classificationData: Record<string, unknown> | null;
  ruleMatch: LegalRuleMatchProjection;
  coverageLimited: boolean;
  supportedEvidenceRefs: string[];
  contradictedEvidenceRefs: string[];
}): GapRow[] {
  const rows: GapRow[] = [];
  rows.push(
    buildFieldRow({
      classificationId: input.classification.id,
      rowKey: ROW_KEYS.systemType,
      fieldValue: input.classificationData?.[ROW_KEYS.systemType],
      coverageLimited: input.coverageLimited,
      supportedEvidenceRefs: input.supportedEvidenceRefs,
      contradictedEvidenceRefs: input.contradictedEvidenceRefs,
    }),
  );
  rows.push(
    buildFieldRow({
      classificationId: input.classification.id,
      rowKey: ROW_KEYS.riskLevel,
      fieldValue: input.classificationData?.[ROW_KEYS.riskLevel],
      coverageLimited: input.coverageLimited,
      supportedEvidenceRefs: input.supportedEvidenceRefs,
      contradictedEvidenceRefs: input.contradictedEvidenceRefs,
    }),
  );
  rows.push(
    buildCitationBasisRow({
      classificationId: input.classification.id,
      fieldValue: input.classificationData?.[ROW_KEYS.citationBasis],
      coverageLimited: input.coverageLimited,
      supportedEvidenceRefs: input.supportedEvidenceRefs,
      contradictedEvidenceRefs: input.contradictedEvidenceRefs,
      allowlist: citationRefs(input.ruleMatch.citationAllowlist),
    }),
  );
  return rows.sort((left, right) => left.rowRef.localeCompare(right.rowRef));
}

function buildFieldRow(input: {
  classificationId: string;
  rowKey: string;
  fieldValue: unknown;
  coverageLimited: boolean;
  supportedEvidenceRefs: string[];
  contradictedEvidenceRefs: string[];
}): GapRow {
  if (input.coverageLimited) {
    return row(
      input.classificationId,
      input.rowKey,
      GAP_MATRIX_ROW_STATUSES.outOfCoverage,
      [],
      GAP_MATRIX_RATIONALE_CODES.coverageLimited,
      GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    );
  }
  if (input.contradictedEvidenceRefs.length > 0) {
    return row(
      input.classificationId,
      input.rowKey,
      GAP_MATRIX_ROW_STATUSES.contradicted,
      [],
      GAP_MATRIX_RATIONALE_CODES.citationOutOfAllowlist,
      GAP_MATRIX_RESOLVER_TYPES.reviewCitations,
    );
  }
  if (
    typeof input.fieldValue === "string" &&
    input.fieldValue.trim().length > 0
  ) {
    if (input.supportedEvidenceRefs.length > 0) {
      return row(
        input.classificationId,
        input.rowKey,
        GAP_MATRIX_ROW_STATUSES.satisfied,
        input.supportedEvidenceRefs,
        GAP_MATRIX_RATIONALE_CODES.verifiedEvidencePresent,
        GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
      );
    }
    return row(
      input.classificationId,
      input.rowKey,
      GAP_MATRIX_ROW_STATUSES.missing,
      [],
      GAP_MATRIX_RATIONALE_CODES.noVerifiedEvidence,
      GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    );
  }
  if (input.fieldValue == null) {
    return row(
      input.classificationId,
      input.rowKey,
      GAP_MATRIX_ROW_STATUSES.missing,
      [],
      GAP_MATRIX_RATIONALE_CODES.noVerifiedEvidence,
      GAP_MATRIX_RESOLVER_TYPES.refreshClassification,
    );
  }
  return row(
    input.classificationId,
    input.rowKey,
    GAP_MATRIX_ROW_STATUSES.unknown,
    [],
    GAP_MATRIX_RATIONALE_CODES.malformedClassificationField,
    GAP_MATRIX_RESOLVER_TYPES.refreshClassification,
  );
}

function buildCitationBasisRow(input: {
  classificationId: string;
  fieldValue: unknown;
  coverageLimited: boolean;
  supportedEvidenceRefs: string[];
  contradictedEvidenceRefs: string[];
  allowlist: Set<string>;
}): GapRow {
  if (input.coverageLimited) {
    return row(
      input.classificationId,
      ROW_KEYS.citationBasis,
      GAP_MATRIX_ROW_STATUSES.outOfCoverage,
      [],
      GAP_MATRIX_RATIONALE_CODES.coverageLimited,
      GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    );
  }
  if (!Array.isArray(input.fieldValue)) {
    if (input.fieldValue == null) {
      return row(
        input.classificationId,
        ROW_KEYS.citationBasis,
        GAP_MATRIX_ROW_STATUSES.missing,
        [],
        GAP_MATRIX_RATIONALE_CODES.noVerifiedEvidence,
        GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
      );
    }
    return row(
      input.classificationId,
      ROW_KEYS.citationBasis,
      GAP_MATRIX_ROW_STATUSES.unknown,
      [],
      GAP_MATRIX_RATIONALE_CODES.malformedClassificationField,
      GAP_MATRIX_RESOLVER_TYPES.refreshClassification,
    );
  }
  const citationBasisRefs = input.fieldValue
    .filter((value): value is string => typeof value === "string")
    .sort();
  if (citationBasisRefs.length === 0) {
    return row(
      input.classificationId,
      ROW_KEYS.citationBasis,
      GAP_MATRIX_ROW_STATUSES.missing,
      [],
      GAP_MATRIX_RATIONALE_CODES.noVerifiedEvidence,
      GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    );
  }
  if (
    input.contradictedEvidenceRefs.length > 0 ||
    citationBasisRefs.some((ref) => !input.allowlist.has(ref))
  ) {
    return row(
      input.classificationId,
      ROW_KEYS.citationBasis,
      GAP_MATRIX_ROW_STATUSES.contradicted,
      [],
      GAP_MATRIX_RATIONALE_CODES.citationOutOfAllowlist,
      GAP_MATRIX_RESOLVER_TYPES.reviewCitations,
    );
  }
  const matchedEvidenceRefs = input.supportedEvidenceRefs.filter((ref) =>
    citationBasisRefs.includes(ref),
  );
  if (matchedEvidenceRefs.length > 0) {
    return row(
      input.classificationId,
      ROW_KEYS.citationBasis,
      GAP_MATRIX_ROW_STATUSES.satisfied,
      matchedEvidenceRefs,
      GAP_MATRIX_RATIONALE_CODES.verifiedEvidencePresent,
      GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    );
  }
  return row(
    input.classificationId,
    ROW_KEYS.citationBasis,
    GAP_MATRIX_ROW_STATUSES.missing,
    [],
    GAP_MATRIX_RATIONALE_CODES.noVerifiedEvidence,
    GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
  );
}

function row(
  classificationId: string,
  rowKey: string,
  status: GapMatrixRowStatus,
  evidenceRefs: string[],
  rationaleCode: GapMatrixRationaleCode,
  resolverType: GapMatrixResolverType,
): GapRow {
  return {
    rowRef: `gap-row:${classificationId}:${rowKey}`,
    status,
    evidenceRefs: evidenceRefs.slice().sort(),
    rationaleCode,
    resolverType,
  };
}

function terminalResponse(
  query: EvaluateGapMatrixQuery,
  status: EvaluateGapMatrixResponse["status"],
  coverageState: EvaluateGapMatrixResponse["coverageState"],
  code: GapMatrixLimitationCode,
  affectedScopeRef: string | null,
  reason: string,
): EvaluateGapMatrixResponse {
  return {
    status,
    toolName: AGENTIC_TOOL_NAMES.evaluateGapMatrix,
    toolVersion: EVALUATE_GAP_MATRIX_TOOL.version,
    configHash: EVALUATE_GAP_MATRIX_TOOL.configHash,
    correlationId: query.correlationId,
    artifactVersions: { matrixRef: query.input.matrixRef },
    provenanceRef: provenanceRef(query.correlationId),
    coverageState,
    evidenceRefs: query.input.evidenceRefs.slice().sort(),
    limitations: [
      {
        code,
        affectedScopeRef,
        reason,
        retryable: false,
      },
    ],
    result: { rows: [] },
  };
}

function idFromRef(ref: string, prefix: string): string {
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

function provenanceRef(correlationId: string): string {
  return `gap-matrix:${safeHash(correlationId).slice(0, 24)}`;
}

function safeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function citationRefs(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(
    value.filter((item): item is string => typeof item === "string").sort(),
  );
}
