import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  EvidenceAcceptanceStatus,
  LegalRuleMatchGuardrailStatus,
  OverallCoverageStatus,
  VerifiedProfileStatus,
} from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  CLASSIFICATION_BASELINE_LABELS,
  CLASSIFICATION_BASELINE_LIMITATION_CODES,
  CLASSIFICATION_BASELINE_PREREQUISITES,
  GET_CLASSIFICATION_BASELINE_TOOL,
  type ClassificationBaselineLimitationCode,
  type ClassificationBaselinePrerequisite,
  type GetClassificationBaselineResponse,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GetClassificationBaselineQuery } from "./get-classification-baseline.query.js";

const PROFILE_REF_PREFIX = "profile_";
const RULE_MATCH_REF_PREFIX = "rule-match:";
const POLICY_REF_PREFIX = "policy_";
const BASELINE_REF_PREFIX = "baseline:";

const REQUIRED_PREREQUISITES = [
  CLASSIFICATION_BASELINE_PREREQUISITES.verifiedProfileApproved,
  CLASSIFICATION_BASELINE_PREREQUISITES.legalRuleMatchAccepted,
  CLASSIFICATION_BASELINE_PREREQUISITES.validCitations,
  CLASSIFICATION_BASELINE_PREREQUISITES.policyProfilePinned,
] as const;

type RuleMatchProjection = {
  id: string;
  verifiedProfileId: string;
  assessmentId: string;
  organizationId: string;
  overallCoverageStatus: OverallCoverageStatus;
  guardrailStatus: LegalRuleMatchGuardrailStatus;
  blockedReason: string | null;
};

@QueryHandler(GetClassificationBaselineQuery)
export class GetClassificationBaselineHandler implements IQueryHandler<
  GetClassificationBaselineQuery,
  GetClassificationBaselineResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetClassificationBaselineQuery,
  ): Promise<GetClassificationBaselineResponse> {
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

    const profileId = idFromRef(
      query.input.verifiedProfileId,
      PROFILE_REF_PREFIX,
    );
    const ruleMatchId = idFromRef(
      query.input.ruleMatchRef,
      RULE_MATCH_REF_PREFIX,
    );
    const [verifiedProfile, ruleMatch, policyOk] = await Promise.all([
      this.prisma.verifiedProfile.findFirst({
        where: {
          id: profileId,
          assessmentId: assessment.id,
          organizationId: query.organizationId,
          status: VerifiedProfileStatus.APPROVED,
        },
        select: { id: true },
      }),
      this.prisma.legalRuleMatch.findFirst({
        where: {
          id: ruleMatchId,
          assessmentId: assessment.id,
          organizationId: query.organizationId,
          verifiedProfileId: profileId,
          status: EvidenceAcceptanceStatus.ACCEPTED,
        },
        select: {
          id: true,
          verifiedProfileId: true,
          assessmentId: true,
          organizationId: true,
          overallCoverageStatus: true,
          guardrailStatus: true,
          blockedReason: true,
        },
      }),
      this.policyMatchesInput(query),
    ]);

    if (!policyOk) {
      return this.writeAndReturn(
        query,
        assessment.id,
        null,
        this.response(
          query,
          null,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          [
            CLASSIFICATION_BASELINE_PREREQUISITES.policyProfilePinned,
            CLASSIFICATION_BASELINE_PREREQUISITES.legalRuleMatchAccepted,
            CLASSIFICATION_BASELINE_PREREQUISITES.validCitations,
          ],
          CLASSIFICATION_BASELINE_LIMITATION_CODES.policyUnavailable,
          query.input.policyProfileVersionId,
          "The policy profile pin is unavailable or does not match the caller policy context.",
        ),
      );
    }

    if (!verifiedProfile) {
      return this.writeAndReturn(
        query,
        assessment.id,
        ruleMatch,
        this.response(
          query,
          ruleMatch,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          [
            CLASSIFICATION_BASELINE_PREREQUISITES.verifiedProfileApproved,
            CLASSIFICATION_BASELINE_PREREQUISITES.legalRuleMatchAccepted,
            CLASSIFICATION_BASELINE_PREREQUISITES.validCitations,
          ],
          CLASSIFICATION_BASELINE_LIMITATION_CODES.profileUnavailable,
          query.input.verifiedProfileId,
          "The pinned verified profile is unavailable or not approved.",
        ),
      );
    }

    if (!ruleMatch) {
      return this.writeAndReturn(
        query,
        assessment.id,
        null,
        this.response(
          query,
          null,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          [
            CLASSIFICATION_BASELINE_PREREQUISITES.legalRuleMatchAccepted,
            CLASSIFICATION_BASELINE_PREREQUISITES.validCitations,
          ],
          CLASSIFICATION_BASELINE_LIMITATION_CODES.ruleMatchUnavailable,
          query.input.ruleMatchRef,
          "The accepted legal rule match is unavailable for this verified profile.",
        ),
      );
    }

    if (ruleMatch.guardrailStatus === LegalRuleMatchGuardrailStatus.BLOCKED) {
      return this.writeAndReturn(
        query,
        assessment.id,
        ruleMatch,
        this.response(
          query,
          ruleMatch,
          AGENTIC_TOOL_STATUSES.conflict,
          AGENTIC_TOOL_COVERAGE_STATES.limited,
          [CLASSIFICATION_BASELINE_PREREQUISITES.validCitations],
          CLASSIFICATION_BASELINE_LIMITATION_CODES.guardrailBlocked,
          query.input.ruleMatchRef,
          ruleMatch.blockedReason ??
            "The legal rule match guardrail blocked classification.",
        ),
      );
    }

    if (
      ruleMatch.overallCoverageStatus !==
      OverallCoverageStatus.COMPLETE_CITATION
    ) {
      return this.writeAndReturn(
        query,
        assessment.id,
        ruleMatch,
        this.response(
          query,
          ruleMatch,
          AGENTIC_TOOL_STATUSES.outOfCoverage,
          AGENTIC_TOOL_COVERAGE_STATES.partial,
          [CLASSIFICATION_BASELINE_PREREQUISITES.validCitations],
          CLASSIFICATION_BASELINE_LIMITATION_CODES.coverageLimited,
          query.input.ruleMatchRef,
          "The legal rule match does not have complete citation coverage.",
        ),
      );
    }

    return this.writeAndReturn(
      query,
      assessment.id,
      ruleMatch,
      this.response(
        query,
        ruleMatch,
        AGENTIC_TOOL_STATUSES.ready,
        AGENTIC_TOOL_COVERAGE_STATES.sufficient,
        [],
        null,
        null,
        null,
      ),
    );
  }

  private async policyMatchesInput(
    query: GetClassificationBaselineQuery,
  ): Promise<boolean> {
    if (!query.policyId || !query.policyVersion) return false;
    if (
      query.input.policyProfileVersionId !==
      policyProfileVersionRef(query.policyId, query.policyVersion)
    ) {
      return false;
    }
    const policy = await this.prisma.authPolicy.findFirst({
      where: {
        id: query.policyId,
        version: query.policyVersion,
        organizationId: query.organizationId,
      },
      select: { actions: true },
    });
    return Boolean(policy?.actions.includes(PBAC_ACTIONS.classificationRun));
  }

  private response(
    query: GetClassificationBaselineQuery,
    ruleMatch: RuleMatchProjection | null,
    status: GetClassificationBaselineResponse["status"],
    coverageState: GetClassificationBaselineResponse["coverageState"],
    unmetPrerequisites: ClassificationBaselinePrerequisite[],
    limitationCode: ClassificationBaselineLimitationCode | null,
    affectedScopeRef: string | null,
    reason: string | null,
  ): GetClassificationBaselineResponse {
    const baselineRef = ruleMatch
      ? baselineRefForRuleMatch(ruleMatch.id)
      : null;
    const limitations =
      limitationCode && reason
        ? [
            {
              code: limitationCode,
              affectedScopeRef,
              reason,
              retryable: false,
            },
          ]
        : [];
    const eligibleLabels =
      status === AGENTIC_TOOL_STATUSES.ready
        ? [CLASSIFICATION_BASELINE_LABELS.candidateA]
        : [];
    return {
      status,
      toolName: AGENTIC_TOOL_NAMES.getClassificationBaseline,
      toolVersion: GET_CLASSIFICATION_BASELINE_TOOL.version,
      configHash: GET_CLASSIFICATION_BASELINE_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: {
        profileId: query.input.verifiedProfileId,
        ruleMatchRef: query.input.ruleMatchRef,
        policyProfileVersionId: query.input.policyProfileVersionId,
      },
      provenanceRef: `provenance:classification-baseline:${query.correlationId}`,
      coverageState,
      evidenceRefs: ruleMatch ? [query.input.ruleMatchRef] : [],
      limitations,
      result: {
        baselineRef,
        eligibleLabels,
        requiredPrerequisites: [...REQUIRED_PREREQUISITES],
        unmetPrerequisites,
      },
    };
  }

  private async writeAndReturn(
    query: GetClassificationBaselineQuery,
    assessmentId: string,
    ruleMatch: RuleMatchProjection | null,
    response: GetClassificationBaselineResponse,
  ): Promise<GetClassificationBaselineResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.classificationBaselineRead,
      actorId: query.actorId,
      organizationId: query.organizationId,
      assessmentId,
      resourceType: ruleMatch
        ? AUDIT_RESOURCE_TYPES.legalRuleMatch
        : AUDIT_RESOURCE_TYPES.assessment,
      resourceId: ruleMatch?.id ?? assessmentId,
      correlationId: query.correlationId,
      policyId: query.policyId,
      policyVersion: query.policyVersion,
      decision:
        response.status === AGENTIC_TOOL_STATUSES.ready ||
        response.status === AGENTIC_TOOL_STATUSES.outOfCoverage
          ? AUDIT_DECISIONS.allow
          : AUDIT_DECISIONS.deny,
      result: response.status,
      payload: {
        toolName: response.toolName,
        baselineRef: response.result.baselineRef,
        profileRef: query.input.verifiedProfileId,
        ruleMatchRef: query.input.ruleMatchRef,
        policyProfileVersionId: query.input.policyProfileVersionId,
        outputHash: safeHash(response),
        limitationCodes: response.limitations.map(({ code }) => code),
      },
    });
    return response;
  }
}

function policyProfileVersionRef(
  policyId: string,
  policyVersion: string,
): string {
  return `${POLICY_REF_PREFIX}${policyId}_${policyVersion}`;
}

function baselineRefForRuleMatch(ruleMatchId: string): string {
  return `${BASELINE_REF_PREFIX}${ruleMatchId}`;
}

function idFromRef(ref: string, prefix: string): string {
  return ref.slice(prefix.length);
}

function safeHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
