import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import {
  AUDIT_ACTOR_TYPES,
  INTERVIEW_AUDIT_EVENT_TYPES,
  INTERVIEW_TECHNICAL_COVERAGE_STATES,
  type AuditActorType,
  type InterviewAuditConflictDetail,
  type InterviewAuditEventType,
  type InterviewAuditTrailItem,
  type InterviewAuditTrailResponse,
  type InterviewSourceSnapshotRef,
  type InterviewTechnicalCoverageState,
} from "@lcsp/contracts/audit";
import {
  ASSESSMENT_INTERVIEW_ANSWER_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  type AssessmentInterviewAnswerAction,
  type AssessmentInterviewControl,
  type AssessmentInterviewOutcome,
  type AssessmentInterviewQuestionIntent,
} from "@lcsp/contracts/evidence";
import { HttpStatus, Injectable } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  cleanString,
  isRecord,
} from "../../../../../common/utils/type-guards.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AuditRedactorService } from "../../services/audit/audit-redactor.service.js";
import { GetInterviewAuditTrailQuery } from "./get-interview-audit-trail.query.js";

function auditActorType(
  value: unknown,
  actorId: string | null,
): AuditActorType {
  if (Object.values(AUDIT_ACTOR_TYPES).includes(value as AuditActorType)) {
    return value as AuditActorType;
  }
  return actorId ? AUDIT_ACTOR_TYPES.user : AUDIT_ACTOR_TYPES.system;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function readTurnId(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return cleanString(value) ?? undefined;
}

function readSourceSnapshot(
  value: unknown,
): InterviewSourceSnapshotRef | undefined {
  if (!isRecord(value)) return undefined;
  const coverageState = cleanString(value.technicalCoverageState);
  const validCoverageState = Object.values(
    INTERVIEW_TECHNICAL_COVERAGE_STATES,
  ).includes(coverageState as InterviewTechnicalCoverageState)
    ? (coverageState as InterviewTechnicalCoverageState)
    : undefined;
  return {
    snapshotId: cleanString(value.snapshotId) ?? undefined,
    commitSha: cleanString(value.commitSha) ?? undefined,
    guidanceVersion: cleanString(value.guidanceVersion) ?? undefined,
    pgeVersion: cleanString(value.pgeVersion) ?? undefined,
    sourceVersion: cleanString(value.sourceVersion) ?? undefined,
    technicalCoverageState: validCoverageState,
    coverageLimitations: stringArray(value.coverageLimitations),
  };
}

function readQuestionIntent(
  value: unknown,
): AssessmentInterviewQuestionIntent | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;
  return Object.values(ASSESSMENT_INTERVIEW_QUESTION_INTENTS).includes(
    cleaned as AssessmentInterviewQuestionIntent,
  )
    ? (cleaned as AssessmentInterviewQuestionIntent)
    : undefined;
}

function readOutcome(value: unknown): AssessmentInterviewOutcome | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;
  return Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).includes(
    cleaned as AssessmentInterviewOutcome,
  )
    ? (cleaned as AssessmentInterviewOutcome)
    : undefined;
}

function readResponseMode(
  value: unknown,
): AssessmentInterviewControl | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;
  return Object.values(ASSESSMENT_INTERVIEW_CONTROLS).includes(
    cleaned as AssessmentInterviewControl,
  )
    ? (cleaned as AssessmentInterviewControl)
    : undefined;
}

function readResponseAction(
  value: unknown,
): AssessmentInterviewAnswerAction | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;
  return Object.values(ASSESSMENT_INTERVIEW_ANSWER_ACTIONS).includes(
    cleaned as AssessmentInterviewAnswerAction,
  )
    ? (cleaned as AssessmentInterviewAnswerAction)
    : undefined;
}

function readActorRef(value: unknown) {
  if (!isRecord(value)) return null;
  const id = cleanString(value.id);
  if (!id || value.authenticated !== true) return null;
  return {
    id,
    role: cleanString(value.role) ?? undefined,
    name: cleanString(value.name) ?? undefined,
    authenticated: true as const,
  };
}

function readConflictDetail(
  value: unknown,
): InterviewAuditConflictDetail | undefined {
  if (!isRecord(value)) return undefined;
  const firstRespondentRef = readActorRef(value.firstRespondent);
  const secondRespondentRef = readActorRef(value.secondRespondent);
  const firstTurnId = readTurnId(value.firstTurnId);
  const secondTurnId = readTurnId(value.secondTurnId);
  if (
    !firstRespondentRef ||
    !secondRespondentRef ||
    firstTurnId === undefined ||
    secondTurnId === undefined
  ) {
    return undefined;
  }
  return {
    firstRespondentRef,
    firstStatementValue: value.firstValue,
    firstTurnId,
    secondRespondentRef,
    secondStatementValue: value.secondValue,
    secondTurnId,
  };
}

/**
 * Handles retrieval of the chronological Interview audit trail and material provenance for an assessment.
 *
 * Enforces Tenant/Assessment Isolation:
 * - Verifies the assessment exists.
 * - Enforces that CUSTOMER subjects can only view assessments they own.
 * - Admin subjects can view any assessment within their authorized scope.
 */
@Injectable()
@QueryHandler(GetInterviewAuditTrailQuery)
export class GetInterviewAuditTrailHandler implements IQueryHandler<
  GetInterviewAuditTrailQuery,
  InterviewAuditTrailResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redactor: AuditRedactorService,
  ) {}

  async execute(
    query: GetInterviewAuditTrailQuery,
  ): Promise<InterviewAuditTrailResponse> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: query.assessmentId },
      select: { id: true, ownerId: true },
    });

    if (!assessment) {
      this.throwNotFound(query.correlationId);
    }

    if (
      query.subjectRole === AUTH_USER_ROLES.customer &&
      assessment.ownerId !== query.sessionUserId
    ) {
      this.throwNotFound(query.correlationId);
    }

    if (
      query.subjectScope &&
      query.subjectScope !== `assessment:${query.assessmentId}`
    ) {
      this.throwNotFound(query.correlationId);
    }

    const eventTypes = Object.values(INTERVIEW_AUDIT_EVENT_TYPES);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const [total, auditRows] = await Promise.all([
      this.prisma.auditEvent.count({
        where: {
          resourceId: query.assessmentId,
          eventType: { in: eventTypes },
        },
      }),
      this.prisma.auditEvent.findMany({
        where: {
          resourceId: query.assessmentId,
          eventType: { in: eventTypes },
        },
        orderBy: { createdAt: "asc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          eventType: true,
          actorId: true,
          correlationId: true,
          sessionId: true,
          payload: true,
          createdAt: true,
        },
      }),
    ]);

    const events: InterviewAuditTrailItem[] = auditRows.map((row) => {
      const redactedPayload = this.redactor.redact(row.payload) ?? {};
      const payloadRecord = isRecord(redactedPayload) ? redactedPayload : {};

      const actor = isRecord(payloadRecord.actor) ? payloadRecord.actor : null;
      const actorRole = cleanString(actor?.role);
      const actorName = cleanString(actor?.name);
      const actorType = auditActorType(actor?.type, row.actorId);
      const respondentRef =
        readActorRef(payloadRecord.respondentRef) ?? undefined;

      const revision =
        cleanString(payloadRecord.interviewContextRevision) ??
        cleanString(payloadRecord.contextRevision) ??
        cleanString(payloadRecord.newRevision);

      const evidenceRefs = Array.isArray(payloadRecord.evidenceRefs)
        ? payloadRecord.evidenceRefs
            .filter((e): e is string => typeof e === "string")
            .map((e) => e.trim())
            .filter(Boolean)
        : [];

      const isConflict =
        row.eventType === INTERVIEW_AUDIT_EVENT_TYPES.contextConflicted;
      const conflict = isConflict
        ? readConflictDetail(payloadRecord.conflict)
        : undefined;
      const sourceSnapshot = readSourceSnapshot(payloadRecord.sourceSnapshot);

      return {
        id: row.id,
        eventType: row.eventType as InterviewAuditEventType,
        actorId: row.actorId,
        actorType,
        actorRole,
        actorName,
        respondentRef,
        assessmentId: query.assessmentId,
        interviewContextRevision: revision,
        correlationId: row.correlationId,
        sessionId: row.sessionId,
        threadId: cleanString(payloadRecord.threadId) ?? undefined,
        turnId: readTurnId(payloadRecord.turnId),
        runId: cleanString(payloadRecord.runId) ?? undefined,
        guidanceVersion:
          cleanString(payloadRecord.guidanceVersion) ??
          sourceSnapshot?.guidanceVersion,
        modelId: cleanString(payloadRecord.modelId) ?? undefined,
        currentStage: cleanString(payloadRecord.stage) ?? undefined,
        sourceSnapshot,
        statementKey: cleanString(payloadRecord.statementKey) ?? undefined,
        statementValue:
          payloadRecord.statementValue ??
          payloadRecord.newValue ??
          payloadRecord.answerValue,
        priorValue: payloadRecord.priorValue,
        priorRevision: cleanString(payloadRecord.priorRevision) ?? undefined,
        isConflict,
        conflict,
        questionId: cleanString(payloadRecord.questionId) ?? undefined,
        questionIntent: readQuestionIntent(payloadRecord.questionIntent),
        responseMode: readResponseMode(payloadRecord.responseMode),
        responseAction: readResponseAction(payloadRecord.responseAction),
        outcome: readOutcome(payloadRecord.outcome),
        interpretation: cleanString(payloadRecord.interpretation) ?? undefined,
        evidenceRefs,
        originatingInvestigationReference:
          cleanString(payloadRecord.originatingInvestigationReference) ??
          undefined,
        downstreamImpact:
          row.eventType ===
            INTERVIEW_AUDIT_EVENT_TYPES.downstreamImpactEmitted ||
          Boolean(payloadRecord.downstreamImpact),
        affectedActivities: stringArray(payloadRecord.affectedActivities),
        rerunScope: stringArray(payloadRecord.rerunScope),
        occurredAt: row.createdAt.toISOString(),
      };
    });

    return {
      assessmentId: query.assessmentId,
      events,
      total,
      limit,
      offset,
    };
  }

  private throwNotFound(correlationId: string): never {
    throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
}
