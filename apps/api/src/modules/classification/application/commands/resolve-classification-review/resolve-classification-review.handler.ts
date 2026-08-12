import { createHash, randomUUID } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ClassificationReviewRequestStatus,
  ConflictRecordStatus,
  EvidenceAcceptanceStatus,
  LegalRuleMatchGuardrailStatus,
  OverallCoverageStatus,
} from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  CLASSIFICATION_REVIEW_DECISIONS,
  CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES,
  CLASSIFICATION_REVIEW_RESOLUTION_STATUSES,
  CLASSIFICATION_REVIEW_RESOLUTION_TOOL,
  type ClassificationReviewResolutionLimitationCode,
  type ResolveClassificationReviewResponse,
} from "@lcsp/contracts/evidence";
import { LEGAL_RISK_LEVELS } from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_SCHEMA_VERSIONS,
  CLASSIFICATION_RESULT_STATUSES,
  OVERALL_COVERAGE_STATUSES,
  SCAN_EVENT_TYPES,
  type OverallCoverageStatus as ContractOverallCoverageStatus,
} from "@lcsp/contracts/scan";

import {
  toPrismaClassificationGuardrailStatus,
  toPrismaEvidenceAcceptanceStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { LegalRuleMatchItemDto } from "../../contracts/classification/legal-rule-match-callback.contract.js";
import { ResolveClassificationReviewCommand } from "./resolve-classification-review.command.js";

const REVIEW_REQUEST_REF_PREFIX = "classification-review:";
const CLASSIFICATION_REF_PREFIX = "classification:";
const REVIEWED_CLASSIFICATION_STATUS = "REVIEWED";

type ReviewRequestProjection = {
  id: string;
  legalRuleMatchId: string;
  requestedById: string;
  citationRefs: unknown;
  status: ClassificationReviewRequestStatus;
  expiresAt: Date;
};

type RuleMatchProjection = {
  id: string;
  verifiedProfileId: string;
  matches: unknown;
  citationAllowlist: unknown;
  overallCoverageStatus: OverallCoverageStatus;
  guardrailStatus: LegalRuleMatchGuardrailStatus;
  blockedReason: string | null;
};

@CommandHandler(ResolveClassificationReviewCommand)
export class ResolveClassificationReviewHandler implements ICommandHandler<
  ResolveClassificationReviewCommand,
  ResolveClassificationReviewResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(
    command: ResolveClassificationReviewCommand,
  ): Promise<ResolveClassificationReviewResponse> {
    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: command.assessmentId,
        organizationId: command.organizationId,
      },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const reviewRequest =
      await this.prisma.classificationReviewRequest.findFirst({
        where: {
          id: idFromRef(
            command.input.reviewRequestRef,
            REVIEW_REQUEST_REF_PREFIX,
          ),
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
        },
        select: {
          id: true,
          legalRuleMatchId: true,
          requestedById: true,
          citationRefs: true,
          status: true,
          expiresAt: true,
        },
      });
    if (!reviewRequest) {
      return this.writeAndReturn(
        command,
        assessment.id,
        terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.reviewRequestUnavailable,
          command.input.reviewRequestRef,
          "The pinned classification review request cannot be resolved.",
        ),
      );
    }

    if (reviewRequest.requestedById === command.actorId) {
      return this.writeAndReturn(
        command,
        assessment.id,
        terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.sufficient,
          CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.reviewerNotIndependent,
          command.input.reviewRequestRef,
          "The independent reviewer cannot be the same actor who submitted the request.",
        ),
      );
    }

    if (
      reviewRequest.status === ClassificationReviewRequestStatus.APPROVED ||
      reviewRequest.status === ClassificationReviewRequestStatus.REJECTED
    ) {
      return this.replayExisting(command, assessment.id, reviewRequest);
    }

    if (
      reviewRequest.status !==
      ClassificationReviewRequestStatus.PENDING_INDEPENDENT_REVIEW
    ) {
      return this.writeAndReturn(
        command,
        assessment.id,
        terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.sufficient,
          CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.requestAlreadyResolved,
          command.input.reviewRequestRef,
          "The review request is no longer pending independent review.",
        ),
      );
    }

    if (reviewRequest.expiresAt.getTime() <= Date.now()) {
      return this.writeAndReturn(
        command,
        assessment.id,
        terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.reviewRequestExpired,
          command.input.reviewRequestRef,
          "The independent review request has expired and must be resubmitted.",
        ),
      );
    }

    const ruleMatch = await this.prisma.legalRuleMatch.findFirst({
      where: {
        id: reviewRequest.legalRuleMatchId,
        assessmentId: command.assessmentId,
        organizationId: command.organizationId,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      select: {
        id: true,
        verifiedProfileId: true,
        matches: true,
        citationAllowlist: true,
        overallCoverageStatus: true,
        guardrailStatus: true,
        blockedReason: true,
      },
    });
    if (!ruleMatch) {
      return this.writeAndReturn(
        command,
        assessment.id,
        terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.baselineUnavailable,
          command.input.reviewRequestRef,
          "The review request lost its accepted legal rule match baseline.",
        ),
      );
    }

    if (command.input.decision === CLASSIFICATION_REVIEW_DECISIONS.reject) {
      return this.rejectRequest(command, assessment.id, reviewRequest);
    }

    const gateFailure = await this.approvalGateFailure(
      command,
      reviewRequest,
      ruleMatch,
    );
    if (gateFailure) {
      return this.writeAndReturn(command, assessment.id, gateFailure);
    }

    return this.approveRequest(
      command,
      assessment.id,
      reviewRequest,
      ruleMatch,
    );
  }

  private async replayExisting(
    command: ResolveClassificationReviewCommand,
    assessmentId: string,
    reviewRequest: ReviewRequestProjection,
  ): Promise<ResolveClassificationReviewResponse> {
    const replayApproved =
      command.input.decision === CLASSIFICATION_REVIEW_DECISIONS.approve &&
      reviewRequest.status === ClassificationReviewRequestStatus.APPROVED;
    const replayRejected =
      command.input.decision === CLASSIFICATION_REVIEW_DECISIONS.reject &&
      reviewRequest.status === ClassificationReviewRequestStatus.REJECTED;
    if (!replayApproved && !replayRejected) {
      return this.writeAndReturn(
        command,
        assessmentId,
        terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.sufficient,
          CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.requestAlreadyResolved,
          command.input.reviewRequestRef,
          "The review request was already resolved with a different decision.",
        ),
      );
    }

    const classification = await this.prisma.classificationResult.findUnique({
      where: { legalRuleMatchId: reviewRequest.legalRuleMatchId },
      select: { id: true },
    });
    const reviewStatus = replayApproved
      ? CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.approved
      : CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.rejected;
    const response: ResolveClassificationReviewResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
      toolVersion: CLASSIFICATION_REVIEW_RESOLUTION_TOOL.version,
      configHash: CLASSIFICATION_REVIEW_RESOLUTION_TOOL.configHash,
      correlationId: command.correlationId,
      artifactVersions: {
        reviewRequestRef: command.input.reviewRequestRef,
      },
      provenanceRef: provenanceRef(command.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: citationRefs(reviewRequest.citationRefs),
      limitations: [],
      result: {
        reviewRequestRef: command.input.reviewRequestRef,
        reviewStatus,
        classificationRef: classification
          ? `${CLASSIFICATION_REF_PREFIX}${classification.id}`
          : null,
        classificationStatus: classification
          ? REVIEWED_CLASSIFICATION_STATUS
          : null,
        decisionAuditRef: auditRef(reviewRequest.id),
      },
    };

    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.classificationReviewResolvedAudit,
      actorId: command.actorId,
      organizationId: command.organizationId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.classificationReviewRequest,
      resourceId: reviewRequest.id,
      correlationId: command.correlationId,
      policyId: command.policyId,
      policyVersion: command.policyVersion,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        toolName: response.toolName,
        replay: true,
        reviewStatus,
        outputHash: safeHash(response.result),
      },
    });
    return response;
  }

  private async approvalGateFailure(
    command: ResolveClassificationReviewCommand,
    reviewRequest: ReviewRequestProjection,
    ruleMatch: RuleMatchProjection,
  ): Promise<ResolveClassificationReviewResponse | null> {
    if (ruleMatch.guardrailStatus === LegalRuleMatchGuardrailStatus.BLOCKED) {
      return terminalResponse(
        command,
        AGENTIC_TOOL_STATUSES.blocked,
        AGENTIC_TOOL_COVERAGE_STATES.limited,
        CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.baselineUnavailable,
        command.input.reviewRequestRef,
        ruleMatch.blockedReason ??
          "The accepted legal rule match guardrail blocks classification approval.",
      );
    }

    if (
      ruleMatch.overallCoverageStatus !==
      OverallCoverageStatus.COMPLETE_CITATION
    ) {
      return terminalResponse(
        command,
        AGENTIC_TOOL_STATUSES.outOfCoverage,
        AGENTIC_TOOL_COVERAGE_STATES.partial,
        CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.coverageLimited,
        command.input.reviewRequestRef,
        "The accepted legal rule match no longer has complete citation coverage.",
      );
    }

    const requestCitations = citationRefs(reviewRequest.citationRefs);
    const allowlist = new Set(citationRefs(ruleMatch.citationAllowlist));
    if (requestCitations.some((ref) => !allowlist.has(ref))) {
      return terminalResponse(
        command,
        AGENTIC_TOOL_STATUSES.blocked,
        AGENTIC_TOOL_COVERAGE_STATES.sufficient,
        CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.citationInvalid,
        command.input.reviewRequestRef,
        "The pinned review citations are no longer in the accepted baseline allowlist.",
      );
    }

    const existingResult = await this.prisma.classificationResult.findUnique({
      where: { legalRuleMatchId: reviewRequest.legalRuleMatchId },
      select: { id: true },
    });
    if (existingResult) {
      return terminalResponse(
        command,
        AGENTIC_TOOL_STATUSES.blocked,
        AGENTIC_TOOL_COVERAGE_STATES.sufficient,
        CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.resultAlreadyExists,
        `${CLASSIFICATION_REF_PREFIX}${existingResult.id}`,
        "A reviewed classification already exists for the pinned baseline.",
      );
    }

    const verifiedProfile = await this.prisma.verifiedProfile.findFirst({
      where: {
        id: ruleMatch.verifiedProfileId,
        assessmentId: command.assessmentId,
        organizationId: command.organizationId,
      },
      select: { aiUsageFlowId: true },
    });
    if (verifiedProfile?.aiUsageFlowId) {
      const conflict = await this.prisma.conflictRecord.findFirst({
        where: {
          aiUsageFlowId: verifiedProfile.aiUsageFlowId,
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
          status: ConflictRecordStatus.PENDING,
        },
        select: { id: true },
      });
      if (conflict) {
        return terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.sufficient,
          CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.conflictOpen,
          `conflict:${conflict.id}`,
          "An open reconciliation conflict still blocks classification approval.",
        );
      }
    }

    return null;
  }

  private async approveRequest(
    command: ResolveClassificationReviewCommand,
    assessmentId: string,
    reviewRequest: ReviewRequestProjection,
    ruleMatch: RuleMatchProjection,
  ): Promise<ResolveClassificationReviewResponse> {
    const classificationResultId = randomUUID();
    const classificationData = buildClassificationData(
      parseMatches(ruleMatch.matches),
      citationRefs(reviewRequest.citationRefs),
    );

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.classificationReviewRequest.updateMany({
        where: {
          id: reviewRequest.id,
          status: ClassificationReviewRequestStatus.PENDING_INDEPENDENT_REVIEW,
        },
        data: { status: ClassificationReviewRequestStatus.APPROVED },
      });
      if (updated.count !== 1) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.invalidRequest,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      await tx.classificationResult.create({
        data: {
          id: classificationResultId,
          legalRuleMatchId: reviewRequest.legalRuleMatchId,
          verifiedProfileId: ruleMatch.verifiedProfileId,
          assessmentId,
          organizationId: command.organizationId,
          schemaVersion: CLASSIFICATION_RESULT_SCHEMA_VERSIONS[0],
          classificationData,
          guardrailStatus: toPrismaClassificationGuardrailStatus(
            CLASSIFICATION_GUARDRAIL_STATUSES.passed,
          ),
          blockedReason: null,
          status: toPrismaEvidenceAcceptanceStatus(
            CLASSIFICATION_RESULT_STATUSES.accepted,
          ),
        },
      });

      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.classificationReviewResolvedAudit,
          actorId: command.actorId,
          organizationId: command.organizationId,
          assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.classificationReviewRequest,
          resourceId: reviewRequest.id,
          correlationId: command.correlationId,
          causationId: reviewRequest.legalRuleMatchId,
          policyId: command.policyId,
          policyVersion: command.policyVersion,
          decision: AUDIT_DECISIONS.allow,
          result: CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.approved,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
          payload: {
            toolName: AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
            decision: command.input.decision,
            decisionCode: command.input.decisionCode,
            reviewRequestRef: command.input.reviewRequestRef,
            classificationRef: `${CLASSIFICATION_REF_PREFIX}${classificationResultId}`,
            outputHash: safeHash(classificationData),
          },
        },
        tx,
      );

      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.classificationReviewRequest,
          aggregateId: reviewRequest.id,
          eventType: SCAN_EVENT_TYPES.classificationReviewResolved,
          organizationId: command.organizationId,
          assessmentId,
          correlationId: command.correlationId,
          causationId: reviewRequest.legalRuleMatchId,
          actor: { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
          result: CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.approved,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: resolutionOutboxKey(
            reviewRequest.id,
            command.input.idempotencyKey,
          ),
          payload: {
            reviewRequestId: reviewRequest.id,
            decision: command.input.decision,
            decisionCode: command.input.decisionCode,
            status: CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.approved,
            classificationResultId,
          },
        }),
        tx,
      );
    });

    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
      toolVersion: CLASSIFICATION_REVIEW_RESOLUTION_TOOL.version,
      configHash: CLASSIFICATION_REVIEW_RESOLUTION_TOOL.configHash,
      correlationId: command.correlationId,
      artifactVersions: {
        reviewRequestRef: command.input.reviewRequestRef,
      },
      provenanceRef: provenanceRef(command.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: classificationData.citation_basis,
      limitations: [],
      result: {
        reviewRequestRef: command.input.reviewRequestRef,
        reviewStatus: CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.approved,
        classificationRef: `${CLASSIFICATION_REF_PREFIX}${classificationResultId}`,
        classificationStatus: REVIEWED_CLASSIFICATION_STATUS,
        decisionAuditRef: auditRef(reviewRequest.id),
      },
    };
  }

  private async rejectRequest(
    command: ResolveClassificationReviewCommand,
    assessmentId: string,
    reviewRequest: ReviewRequestProjection,
  ): Promise<ResolveClassificationReviewResponse> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.classificationReviewRequest.updateMany({
        where: {
          id: reviewRequest.id,
          status: ClassificationReviewRequestStatus.PENDING_INDEPENDENT_REVIEW,
        },
        data: { status: ClassificationReviewRequestStatus.REJECTED },
      });
      if (updated.count !== 1) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.invalidRequest,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.classificationReviewResolvedAudit,
          actorId: command.actorId,
          organizationId: command.organizationId,
          assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.classificationReviewRequest,
          resourceId: reviewRequest.id,
          correlationId: command.correlationId,
          causationId: reviewRequest.legalRuleMatchId,
          policyId: command.policyId,
          policyVersion: command.policyVersion,
          decision: AUDIT_DECISIONS.allow,
          result: CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.rejected,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
          payload: {
            toolName: AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
            decision: command.input.decision,
            decisionCode: command.input.decisionCode,
            reviewRequestRef: command.input.reviewRequestRef,
            outputHash: safeHash({
              decision: command.input.decision,
              decisionCode: command.input.decisionCode,
            }),
          },
        },
        tx,
      );

      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.classificationReviewRequest,
          aggregateId: reviewRequest.id,
          eventType: SCAN_EVENT_TYPES.classificationReviewResolved,
          organizationId: command.organizationId,
          assessmentId,
          correlationId: command.correlationId,
          causationId: reviewRequest.legalRuleMatchId,
          actor: { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
          result: CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.rejected,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: resolutionOutboxKey(
            reviewRequest.id,
            command.input.idempotencyKey,
          ),
          payload: {
            reviewRequestId: reviewRequest.id,
            decision: command.input.decision,
            decisionCode: command.input.decisionCode,
            status: CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.rejected,
            classificationResultId: null,
          },
        }),
        tx,
      );
    });

    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
      toolVersion: CLASSIFICATION_REVIEW_RESOLUTION_TOOL.version,
      configHash: CLASSIFICATION_REVIEW_RESOLUTION_TOOL.configHash,
      correlationId: command.correlationId,
      artifactVersions: {
        reviewRequestRef: command.input.reviewRequestRef,
      },
      provenanceRef: provenanceRef(command.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: citationRefs(reviewRequest.citationRefs),
      limitations: [],
      result: {
        reviewRequestRef: command.input.reviewRequestRef,
        reviewStatus: CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.rejected,
        classificationRef: null,
        classificationStatus: null,
        decisionAuditRef: auditRef(reviewRequest.id),
      },
    };
  }

  private async writeAndReturn(
    command: ResolveClassificationReviewCommand,
    assessmentId: string,
    response: ResolveClassificationReviewResponse,
  ): Promise<ResolveClassificationReviewResponse> {
    if (response.status === AGENTIC_TOOL_STATUSES.ready) return response;
    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.classificationReviewResolvedAudit,
      actorId: command.actorId,
      organizationId: command.organizationId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.classificationReviewRequest,
      resourceId: idFromRef(
        command.input.reviewRequestRef,
        REVIEW_REQUEST_REF_PREFIX,
      ),
      correlationId: command.correlationId,
      policyId: command.policyId,
      policyVersion: command.policyVersion,
      decision: AUDIT_DECISIONS.deny,
      result: response.status,
      payload: {
        toolName: response.toolName,
        reviewRequestRef: command.input.reviewRequestRef,
        decision: command.input.decision,
        decisionCode: command.input.decisionCode,
        outputHash: safeHash(response.result),
        limitationCodes: response.limitations.map(({ code }) => code),
      },
    });
    return response;
  }
}

function terminalResponse(
  command: ResolveClassificationReviewCommand,
  status: ResolveClassificationReviewResponse["status"],
  coverageState: ResolveClassificationReviewResponse["coverageState"],
  code: ClassificationReviewResolutionLimitationCode,
  ref: string | null,
  reason: string,
): ResolveClassificationReviewResponse {
  return {
    status,
    toolName: AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
    toolVersion: CLASSIFICATION_REVIEW_RESOLUTION_TOOL.version,
    configHash: CLASSIFICATION_REVIEW_RESOLUTION_TOOL.configHash,
    correlationId: command.correlationId,
    artifactVersions: {
      reviewRequestRef: command.input.reviewRequestRef,
    },
    provenanceRef: provenanceRef(command.correlationId),
    coverageState,
    evidenceRefs: [],
    limitations: [{ code, affectedScopeRef: ref, reason, retryable: false }],
    result: {
      reviewRequestRef: command.input.reviewRequestRef,
      reviewStatus:
        command.input.decision === CLASSIFICATION_REVIEW_DECISIONS.approve
          ? CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.approved
          : CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.rejected,
      classificationRef: null,
      classificationStatus: null,
      decisionAuditRef: auditRef(
        idFromRef(command.input.reviewRequestRef, REVIEW_REQUEST_REF_PREFIX),
      ),
    },
  };
}

function buildClassificationData(
  matches: LegalRuleMatchItemDto[],
  citationBasis: string[],
) {
  const { riskLevel, applicabilityAssessment, citationCoverage } =
    calculateRiskTier(matches);
  return {
    risk_level: riskLevel,
    applicability_assessment: applicabilityAssessment,
    citation_basis: citationBasis,
    citation_coverage: citationCoverage,
    rationale: null,
    guardrail_reason: null,
  };
}

function calculateRiskTier(matches: LegalRuleMatchItemDto[]) {
  if (matches.length === 0) {
    return {
      riskLevel: LEGAL_RISK_LEVELS.low,
      applicabilityAssessment: "not_applicable",
      citationCoverage: OVERALL_COVERAGE_STATUSES.noCitation,
    };
  }

  let citationCoverage: ContractOverallCoverageStatus =
    OVERALL_COVERAGE_STATUSES.partialCitation;
  const coverages = matches.map(
    (match) => match.coverage_status ?? OVERALL_COVERAGE_STATUSES.noCitation,
  );
  if (
    coverages.every(
      (coverage) => coverage === OVERALL_COVERAGE_STATUSES.completeCitation,
    )
  ) {
    citationCoverage = OVERALL_COVERAGE_STATUSES.completeCitation;
  } else if (
    coverages.every(
      (coverage) => coverage === OVERALL_COVERAGE_STATUSES.noCitation,
    )
  ) {
    citationCoverage = OVERALL_COVERAGE_STATUSES.noCitation;
  }

  const maxConfidence = Math.max(
    ...matches.map((match) =>
      typeof match.confidence === "number" ? match.confidence : 0,
    ),
  );

  if (citationCoverage === OVERALL_COVERAGE_STATUSES.noCitation) {
    return {
      riskLevel: AGENTIC_TOOL_STATUSES.blocked,
      applicabilityAssessment: "not_applicable",
      citationCoverage,
    };
  }
  if (citationCoverage === OVERALL_COVERAGE_STATUSES.partialCitation) {
    return {
      riskLevel: LEGAL_RISK_LEVELS.high,
      applicabilityAssessment: "partially_applicable",
      citationCoverage,
    };
  }
  if (maxConfidence > 0.8) {
    return {
      riskLevel: LEGAL_RISK_LEVELS.high,
      applicabilityAssessment: "applicable",
      citationCoverage,
    };
  }
  if (maxConfidence > 0.5) {
    return {
      riskLevel: LEGAL_RISK_LEVELS.medium,
      applicabilityAssessment: "applicable",
      citationCoverage,
    };
  }
  return {
    riskLevel: LEGAL_RISK_LEVELS.low,
    applicabilityAssessment: "applicable",
    citationCoverage,
  };
}

function parseMatches(value: unknown): LegalRuleMatchItemDto[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isLegalRuleMatchItem);
}

function isLegalRuleMatchItem(value: unknown): value is LegalRuleMatchItemDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.match_id === "string" &&
    typeof item.rule_id === "string" &&
    typeof item.confidence === "number"
  );
}

function citationRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item) => {
        if (typeof item !== "string") return [];
        if (item.startsWith("citation:")) return [item];
        return [`citation:${item}`];
      }),
    ),
  ].sort();
}

function idFromRef(ref: string, prefix: string): string {
  return ref.slice(prefix.length);
}

function provenanceRef(correlationId: string): string {
  return `provenance:classification-review-resolve:${correlationId}`;
}

function auditRef(reviewRequestId: string): string {
  return `audit:classification-review:${reviewRequestId}`;
}

function resolutionOutboxKey(reviewRequestId: string, key: string): string {
  return `${reviewRequestId}:classification-review-resolved:${key}`;
}

function safeHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
