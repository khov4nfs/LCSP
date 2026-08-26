import { createHash } from "node:crypto";

import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  GAP_REQUIREMENT_LIMITATION_CODES,
  GET_GAP_REQUIREMENTS_TOOL,
  type GetGapRequirementsResponse,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  ClassificationGuardrailStatus,
  EvidenceAcceptanceStatus,
} from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GetGapRequirementsQuery } from "./get-gap-requirements.query.js";

const CLASSIFICATION_REF_PREFIX = "classification:";
const POLICY_REF_PREFIX = "rbac-role_";
const MATRIX_REF_PREFIX = "matrix:";
const REQUIREMENT_LOCATORS = {
  applicabilityAssessment: "classification.applicability_assessment",
  riskLevel: "classification.risk_level",
  citationBasis: "classification.citation_basis",
} as const;

@QueryHandler(GetGapRequirementsQuery)
export class GetGapRequirementsHandler implements IQueryHandler<
  GetGapRequirementsQuery,
  GetGapRequirementsResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetGapRequirementsQuery,
  ): Promise<GetGapRequirementsResponse> {
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

    const classificationId = idFromRef(
      query.input.classificationRef,
      CLASSIFICATION_REF_PREFIX,
    );
    const classification = await this.prisma.classificationResult.findFirst({
      where: {
        id: classificationId,
        assessmentId: assessment.id,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      select: {
        id: true,
        classificationData: true,
        guardrailStatus: true,
        blockedReason: true,
      },
    });
    const policyOk = this.policyMatchesInput(query);

    if (!policyOk) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          GAP_REQUIREMENT_LIMITATION_CODES.policyUnavailable,
          query.input.policyProfileVersionId,
          "The policy profile pin is unavailable or does not match the caller policy context.",
        ),
      );
    }

    if (!classification) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          GAP_REQUIREMENT_LIMITATION_CODES.classificationUnavailable,
          query.input.classificationRef,
          "The pinned classification cannot be resolved to an accepted classification result.",
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
          GAP_REQUIREMENT_LIMITATION_CODES.classificationBlocked,
          query.input.classificationRef,
          classification.blockedReason ??
            "The classification result guardrail blocks gap requirements.",
        ),
      );
    }

    const requirements = materializeRequirements(
      classification.id,
      classification.classificationData,
    );
    if (requirements.length === 0) {
      return this.writeAndReturn(
        query,
        assessment.id,
        terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          GAP_REQUIREMENT_LIMITATION_CODES.requirementsUnavailable,
          query.input.classificationRef,
          "The accepted classification does not expose any deterministic requirement fields.",
        ),
      );
    }

    const response: GetGapRequirementsResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.getGapRequirements,
      toolVersion: GET_GAP_REQUIREMENTS_TOOL.version,
      configHash: GET_GAP_REQUIREMENTS_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: {
        classificationRef: query.input.classificationRef,
        policyProfileVersionId: query.input.policyProfileVersionId,
      },
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: requirements.map((item) => item.requirementId),
      limitations: [],
      result: {
        matrixRef: `${MATRIX_REF_PREFIX}${classification.id}`,
        requirements,
        nextCursor: null,
      },
    };

    return this.writeAndReturn(query, assessment.id, response);
  }

  private policyMatchesInput(query: GetGapRequirementsQuery): boolean {
    return (
      query.input.policyProfileVersionId ===
        roleProfileVersionRef(query.actorRole) &&
      query.actorRole === AUTH_USER_ROLES.customer
    );
  }

  private async writeAndReturn(
    query: GetGapRequirementsQuery,
    assessmentId: string,
    response: GetGapRequirementsResponse,
  ): Promise<GetGapRequirementsResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.gapRequirementsRead,
      actorId: query.actorId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        toolName: response.toolName,
        classificationRef: response.artifactVersions.classificationRef,
        policyProfileVersionId:
          response.artifactVersions.policyProfileVersionId,
        outputHash: safeHash(response.result),
        requirementCount: response.result.requirements.length,
        status: response.status,
        coverageState: response.coverageState,
      },
    });
    return response;
  }
}

function terminalResponse(
  query: GetGapRequirementsQuery,
  status: GetGapRequirementsResponse["status"],
  coverageState: GetGapRequirementsResponse["coverageState"],
  code: (typeof GAP_REQUIREMENT_LIMITATION_CODES)[keyof typeof GAP_REQUIREMENT_LIMITATION_CODES],
  ref: string | null,
  reason: string,
): GetGapRequirementsResponse {
  return {
    status,
    toolName: AGENTIC_TOOL_NAMES.getGapRequirements,
    toolVersion: GET_GAP_REQUIREMENTS_TOOL.version,
    configHash: GET_GAP_REQUIREMENTS_TOOL.configHash,
    correlationId: query.correlationId,
    artifactVersions: {
      classificationRef: query.input.classificationRef,
      policyProfileVersionId: query.input.policyProfileVersionId,
    },
    provenanceRef: provenanceRef(query.correlationId),
    coverageState,
    evidenceRefs: [],
    limitations: [{ code, affectedScopeRef: ref, reason, retryable: false }],
    result: {
      matrixRef: null,
      requirements: [],
      nextCursor: null,
    },
  };
}

function materializeRequirements(
  classificationId: string,
  classificationData: unknown,
): GetGapRequirementsResponse["result"]["requirements"] {
  const data = asRecord(classificationData);
  const rows = [
    requirement(
      classificationId,
      "applicability_assessment",
      firstPresentString(data?.applicability_assessment, data?.system_type),
      REQUIREMENT_LOCATORS.applicabilityAssessment,
    ),
    requirement(
      classificationId,
      "risk_level",
      data?.risk_level,
      REQUIREMENT_LOCATORS.riskLevel,
    ),
    requirement(
      classificationId,
      "citation_basis",
      Array.isArray(data?.citation_basis) ? data?.citation_basis : null,
      REQUIREMENT_LOCATORS.citationBasis,
    ),
  ].flatMap((item) => (item ? [item] : []));

  return rows
    .sort((left, right) =>
      left.requirementId.localeCompare(right.requirementId),
    )
    .slice(0, GET_GAP_REQUIREMENTS_TOOL.maxRequirements);
}

function requirement(
  classificationId: string,
  suffix: string,
  value: unknown,
  locator: string,
): { requirementId: string; locator: string } | null {
  if (typeof value === "string" && value.trim()) {
    return {
      requirementId: `requirement:${classificationId}:${suffix}`,
      locator,
    };
  }
  if (Array.isArray(value) && value.length > 0) {
    return {
      requirementId: `requirement:${classificationId}:${suffix}`,
      locator,
    };
  }
  return null;
}

function idFromRef(ref: string, prefix: string): string {
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

function roleProfileVersionRef(role: string): string {
  return `${POLICY_REF_PREFIX}${role}`;
}

function provenanceRef(correlationId: string): string {
  return `tool-execution:${correlationId}`;
}

function safeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstPresentString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}
