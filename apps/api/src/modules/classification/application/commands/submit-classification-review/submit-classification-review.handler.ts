import { createHash, randomUUID } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";
import {
  ClassificationReviewRequestStatus as PrismaClassificationReviewRequestStatus,
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
  CLASSIFICATION_BASELINE_LABELS,
  CLASSIFICATION_REVIEW_REQUEST_STATUSES,
  CLASSIFICATION_REVIEW_REQUIRED_ACTIONS,
  CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES,
  CLASSIFICATION_REVIEW_SUBMISSION_TOOL,
  type ClassificationReviewSubmissionLimitationCode,
  type SubmitClassificationReviewResponse,
} from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { SCAN_ERROR_CODES, SCAN_EVENT_TYPES } from "@lcsp/contracts/scan";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { proposalGateRef } from "../../queries/validate-classification-proposal/validate-classification-proposal.handler.js";
import { SubmitClassificationReviewCommand } from "./submit-classification-review.command.js";

const BASELINE_REF_PREFIX = "baseline:";
const CITATION_REF_PREFIX = "citation:";
const REVIEW_REQUEST_REF_PREFIX = "classification-review:";
const EXPIRY_MS =
  CLASSIFICATION_REVIEW_SUBMISSION_TOOL.expiresInDays * 24 * 60 * 60 * 1000;

type ReviewRequestProjection = {
  id: string;
  legalRuleMatchId: string;
  proposalGateRef: string;
  baselineRef: string;
  candidateLabel: string;
  citationRefs: unknown;
  status: PrismaClassificationReviewRequestStatus;
  expiresAt: Date;
};

type RuleMatchProjection = {
  id: string;
  verifiedProfileId: string;
  citationAllowlist: unknown;
  overallCoverageStatus: OverallCoverageStatus;
  guardrailStatus: LegalRuleMatchGuardrailStatus;
  blockedReason: string | null;
};

@CommandHandler(SubmitClassificationReviewCommand)
export class SubmitClassificationReviewHandler implements ICommandHandler<
  SubmitClassificationReviewCommand,
  SubmitClassificationReviewResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(
    command: SubmitClassificationReviewCommand,
  ): Promise<SubmitClassificationReviewResponse> {
    this.assertInput(command);
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

    const expectedGateRef = proposalGateRef(command.input);
    if (command.input.proposalGateRef !== expectedGateRef) {
      return this.writeAndReturn(
        command,
        assessment.id,
        null,
        this.terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.gatePayloadMismatch,
          command.input.proposalGateRef,
          "The proposal gate reference does not match the pinned proposal payload.",
        ),
      );
    }

    const ruleMatchId = idFromRef(
      command.input.baselineRef,
      BASELINE_REF_PREFIX,
    );
    const [ruleMatch, existingResult, existingRequest] = await Promise.all([
      this.prisma.legalRuleMatch.findFirst({
        where: {
          id: ruleMatchId,
          assessmentId: assessment.id,
          organizationId: command.organizationId,
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
      }),
      this.prisma.classificationResult.findUnique({
        where: { legalRuleMatchId: ruleMatchId },
        select: { id: true },
      }),
      this.prisma.classificationReviewRequest.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: command.organizationId,
            idempotencyKey: command.input.idempotencyKey,
          },
        },
        select: reviewRequestSelect(),
      }),
    ]);

    if (existingRequest) {
      return this.replayExisting(command, assessment.id, existingRequest);
    }

    if (!ruleMatch) {
      return this.writeAndReturn(
        command,
        assessment.id,
        null,
        this.terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.gateUnavailable,
          command.input.baselineRef,
          "The pinned baseline cannot be resolved to an accepted legal rule match.",
        ),
      );
    }

    const failedGate = gateFailure(command, ruleMatch, existingResult !== null);
    if (failedGate) {
      return this.writeAndReturn(
        command,
        assessment.id,
        ruleMatch,
        this.terminalResponse(
          command,
          failedGate.status,
          failedGate.coverageState,
          failedGate.code,
          failedGate.ref,
          failedGate.reason,
        ),
      );
    }

    const openConflict = await this.hasOpenConflict(command, ruleMatch);
    if (openConflict) {
      return this.writeAndReturn(
        command,
        assessment.id,
        ruleMatch,
        this.terminalResponse(
          command,
          AGENTIC_TOOL_STATUSES.blocked,
          AGENTIC_TOOL_COVERAGE_STATES.sufficient,
          CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.conflictOpen,
          `conflict:${openConflict}`,
          "An open reconciliation conflict still blocks independent classification review.",
        ),
      );
    }

    const response = await this.createRequest(
      command,
      assessment.id,
      ruleMatch,
    );
    return this.writeAndReturn(command, assessment.id, ruleMatch, response);
  }

  private async replayExisting(
    command: SubmitClassificationReviewCommand,
    assessmentId: string,
    existing: ReviewRequestProjection,
  ): Promise<SubmitClassificationReviewResponse> {
    if (
      existing.legalRuleMatchId !==
        idFromRef(command.input.baselineRef, BASELINE_REF_PREFIX) ||
      existing.proposalGateRef !== command.input.proposalGateRef ||
      existing.baselineRef !== command.input.baselineRef ||
      existing.candidateLabel !== command.input.candidateLabel ||
      !sameRefs(citationRefs(existing.citationRefs), command.input.citationRefs)
    ) {
      throw problemException(
        SCAN_ERROR_CODES.classificationReviewRequestAlreadyExists,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const response = readyResponse(
      command,
      existing.id,
      existing.expiresAt,
      citationRefs(existing.citationRefs),
    );
    return this.writeAndReturn(command, assessmentId, null, response);
  }

  private async hasOpenConflict(
    command: SubmitClassificationReviewCommand,
    ruleMatch: RuleMatchProjection,
  ): Promise<string | null> {
    const verifiedProfile = await this.prisma.verifiedProfile.findFirst({
      where: {
        id: ruleMatch.verifiedProfileId,
        assessmentId: command.assessmentId,
        organizationId: command.organizationId,
      },
      select: { aiUsageFlowId: true },
    });
    if (!verifiedProfile) return null;
    const conflict = await this.prisma.conflictRecord.findFirst({
      where: {
        aiUsageFlowId: verifiedProfile.aiUsageFlowId,
        assessmentId: command.assessmentId,
        organizationId: command.organizationId,
        status: ConflictRecordStatus.PENDING,
      },
      select: { id: true },
    });
    return conflict?.id ?? null;
  }

  private async createRequest(
    command: SubmitClassificationReviewCommand,
    assessmentId: string,
    ruleMatch: RuleMatchProjection,
  ): Promise<SubmitClassificationReviewResponse> {
    const reviewRequestId = randomUUID();
    const expiresAt = new Date(Date.now() + EXPIRY_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.classificationReviewRequest.create({
        data: {
          id: reviewRequestId,
          legalRuleMatchId: ruleMatch.id,
          assessmentId,
          organizationId: command.organizationId,
          proposalGateRef: command.input.proposalGateRef,
          baselineRef: command.input.baselineRef,
          candidateLabel: command.input.candidateLabel,
          citationRefs: command.input.citationRefs.slice().sort(),
          requestedById: command.actorId,
          idempotencyKey: command.input.idempotencyKey,
          status:
            PrismaClassificationReviewRequestStatus.PENDING_INDEPENDENT_REVIEW,
          expiresAt,
        },
      });

      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.classificationReviewRequestedAudit,
          actorId: command.actorId,
          organizationId: command.organizationId,
          assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.classificationReviewRequest,
          resourceId: reviewRequestId,
          correlationId: command.correlationId,
          causationId: ruleMatch.id,
          policyId: command.policyId,
          policyVersion: command.policyVersion,
          decision: AUDIT_DECISIONS.allow,
          result: SCAN_EVENT_TYPES.classificationReviewRequestedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
          payload: {
            toolName:
              AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview,
            proposalGateRef: command.input.proposalGateRef,
            baselineRef: command.input.baselineRef,
            proposalHash: safeHash({
              candidateLabel: command.input.candidateLabel,
              citationRefs: command.input.citationRefs.slice().sort(),
            }),
            outputRef: `${REVIEW_REQUEST_REF_PREFIX}${reviewRequestId}`,
          },
        },
        tx,
      );

      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.classificationReviewRequest,
          aggregateId: reviewRequestId,
          eventType: SCAN_EVENT_TYPES.classificationReviewRequested,
          organizationId: command.organizationId,
          assessmentId,
          correlationId: command.correlationId,
          causationId: ruleMatch.id,
          actor: { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
          result: SCAN_EVENT_TYPES.classificationReviewRequested,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `${reviewRequestId}:${SCAN_EVENT_TYPES.classificationReviewRequested}`,
          payload: {
            reviewRequestId,
            status:
              CLASSIFICATION_REVIEW_REQUEST_STATUSES.pendingIndependentReview,
            proposalGateRef: command.input.proposalGateRef,
            baselineRef: command.input.baselineRef,
            expiresAt: expiresAt.toISOString(),
          },
        }),
        tx,
      );
    });

    return readyResponse(
      command,
      reviewRequestId,
      expiresAt,
      command.input.citationRefs,
    );
  }

  private terminalResponse(
    command: SubmitClassificationReviewCommand,
    status: SubmitClassificationReviewResponse["status"],
    coverageState: SubmitClassificationReviewResponse["coverageState"],
    code: ClassificationReviewSubmissionLimitationCode,
    ref: string | null,
    reason: string,
  ): SubmitClassificationReviewResponse {
    return {
      status,
      toolName: AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview,
      toolVersion: CLASSIFICATION_REVIEW_SUBMISSION_TOOL.version,
      configHash: CLASSIFICATION_REVIEW_SUBMISSION_TOOL.configHash,
      correlationId: command.correlationId,
      artifactVersions: {
        baselineRef: command.input.baselineRef,
        proposalGateRef: command.input.proposalGateRef,
      },
      provenanceRef: provenanceRef(command.correlationId),
      coverageState,
      evidenceRefs: [],
      limitations: [{ code, affectedScopeRef: ref, reason, retryable: false }],
      result: {
        reviewRequestRef: null,
        status: null,
        proposalGateRef: command.input.proposalGateRef,
        requiredReviewerAction: null,
        expiresAt: null,
      },
    };
  }

  private async writeAndReturn(
    command: SubmitClassificationReviewCommand,
    assessmentId: string,
    ruleMatch: RuleMatchProjection | null,
    response: SubmitClassificationReviewResponse,
  ): Promise<SubmitClassificationReviewResponse> {
    if (response.status === AGENTIC_TOOL_STATUSES.ready) return response;
    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.classificationReviewRequestedAudit,
      actorId: command.actorId,
      organizationId: command.organizationId,
      assessmentId,
      resourceType: ruleMatch
        ? AUDIT_RESOURCE_TYPES.legalRuleMatch
        : AUDIT_RESOURCE_TYPES.assessment,
      resourceId: ruleMatch?.id ?? assessmentId,
      correlationId: command.correlationId,
      policyId: command.policyId,
      policyVersion: command.policyVersion,
      decision: AUDIT_DECISIONS.deny,
      result: response.status,
      payload: {
        toolName: response.toolName,
        baselineRef: command.input.baselineRef,
        proposalGateRef: command.input.proposalGateRef,
        outputHash: safeHash(response),
        limitationCodes: response.limitations.map(({ code }) => code),
      },
    });
    return response;
  }

  private assertInput(command: SubmitClassificationReviewCommand): void {
    if (
      !command.input.proposalGateRef.startsWith("classification-gate:") ||
      !command.input.baselineRef.startsWith(BASELINE_REF_PREFIX) ||
      !command.input.candidateLabel ||
      !command.input.idempotencyKey ||
      command.input.citationRefs.length === 0 ||
      command.input.citationRefs.length >
        CLASSIFICATION_REVIEW_SUBMISSION_TOOL.maxCitationRefs ||
      new Set(command.input.citationRefs).size !==
        command.input.citationRefs.length ||
      command.input.citationRefs.some(
        (ref) => !ref.startsWith(CITATION_REF_PREFIX),
      )
    ) {
      throw problemException(
        SCAN_ERROR_CODES.classificationReviewGateInvalid,
        command.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
  }
}

function readyResponse(
  command: SubmitClassificationReviewCommand,
  reviewRequestId: string,
  expiresAt: Date,
  evidenceRefs: string[],
): SubmitClassificationReviewResponse {
  return {
    status: AGENTIC_TOOL_STATUSES.ready,
    toolName: AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview,
    toolVersion: CLASSIFICATION_REVIEW_SUBMISSION_TOOL.version,
    configHash: CLASSIFICATION_REVIEW_SUBMISSION_TOOL.configHash,
    correlationId: command.correlationId,
    artifactVersions: {
      baselineRef: command.input.baselineRef,
      proposalGateRef: command.input.proposalGateRef,
    },
    provenanceRef: provenanceRef(command.correlationId),
    coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    evidenceRefs: evidenceRefs.slice().sort(),
    limitations: [],
    result: {
      reviewRequestRef: `${REVIEW_REQUEST_REF_PREFIX}${reviewRequestId}`,
      status: CLASSIFICATION_REVIEW_REQUEST_STATUSES.pendingIndependentReview,
      proposalGateRef: command.input.proposalGateRef,
      requiredReviewerAction:
        CLASSIFICATION_REVIEW_REQUIRED_ACTIONS.approveOrReject,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

function gateFailure(
  command: SubmitClassificationReviewCommand,
  ruleMatch: RuleMatchProjection,
  resultExists: boolean,
): {
  status: SubmitClassificationReviewResponse["status"];
  coverageState: SubmitClassificationReviewResponse["coverageState"];
  code: ClassificationReviewSubmissionLimitationCode;
  ref: string;
  reason: string;
} | null {
  if (ruleMatch.guardrailStatus === LegalRuleMatchGuardrailStatus.BLOCKED) {
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.limited,
      code: CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.gateFailed,
      ref: command.input.baselineRef,
      reason:
        ruleMatch.blockedReason ??
        "The baseline legal rule match guardrail blocks classification.",
    };
  }
  if (
    ruleMatch.overallCoverageStatus !== OverallCoverageStatus.COMPLETE_CITATION
  ) {
    return {
      status: AGENTIC_TOOL_STATUSES.outOfCoverage,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.partial,
      code: CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.citationCoverageLimited,
      ref: command.input.baselineRef,
      reason: "The baseline does not have complete citation coverage.",
    };
  }
  if (
    command.input.candidateLabel !== CLASSIFICATION_BASELINE_LABELS.candidateA
  ) {
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      code: CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.gateFailed,
      ref: command.input.candidateLabel,
      reason: "The proposal candidate is not eligible in the pinned baseline.",
    };
  }
  const allowlist = citationRefs(ruleMatch.citationAllowlist);
  if (
    command.input.citationRefs.some(
      (citationRef) => !allowlist.includes(citationRef),
    )
  ) {
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      code: CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.gateFailed,
      ref: command.input.proposalGateRef,
      reason:
        "The proposal citations are not in the pinned baseline allowlist.",
    };
  }
  if (resultExists) {
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      code: CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.resultAlreadyExists,
      ref: command.input.baselineRef,
      reason: "A classification result already exists for the pinned baseline.",
    };
  }
  return null;
}

function reviewRequestSelect() {
  return {
    id: true,
    legalRuleMatchId: true,
    proposalGateRef: true,
    baselineRef: true,
    candidateLabel: true,
    citationRefs: true,
    status: true,
    expiresAt: true,
  } satisfies Prisma.ClassificationReviewRequestSelect;
}

function citationRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item) => {
        if (typeof item !== "string") return [];
        if (item.startsWith(CITATION_REF_PREFIX) && item.includes("chunk_")) {
          return [item];
        }
        if (item.startsWith("chunk_")) return [`${CITATION_REF_PREFIX}${item}`];
        return [];
      }),
    ),
  ].sort();
}

function sameRefs(expected: string[], provided: string[]): boolean {
  return (
    JSON.stringify(expected.slice().sort()) ===
    JSON.stringify(provided.slice().sort())
  );
}

function idFromRef(ref: string, prefix: string): string {
  return ref.slice(prefix.length);
}

function provenanceRef(correlationId: string): string {
  return `provenance:classification-review:${correlationId}`;
}

function safeHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
