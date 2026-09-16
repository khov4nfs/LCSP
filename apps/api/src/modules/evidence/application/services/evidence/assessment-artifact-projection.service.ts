import { Injectable } from "@nestjs/common";
import {
  ASSESSMENT_ARTIFACT_STATUSES,
  ASSESSMENT_ARTIFACT_TYPES,
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  BUSINESS_CONTEXT_DIMENSIONS,
  BUSINESS_CONTEXT_DIMENSION_STATUSES,
  INVESTIGATION_ASSESSMENT_OUTCOMES,
  INVESTIGATION_EVIDENCE_QUALITIES,
  INVESTIGATION_EXECUTION_STATUSES,
  INVESTIGATION_RULE_OUTCOMES,
  isConfirmedStructuredBusinessContext,
  type AssessmentArtifactAvailabilityProjection,
  type AssessmentRuntimeActivityEvent,
  type BusinessContextArtifact,
  type BusinessContextDimension,
  type InvestigationNotesArtifact,
  type InvestigationRuleNote,
} from "@lcsp/contracts/evidence";
import {
  ENGINEERING_RULE_EVALUATION_STATUSES,
  type EngineeringRuleEvaluationStatus,
} from "@lcsp/contracts/scan";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { sanitizePublicText } from "../../../../assessment/application/services/assessment-interview-runtime.service.js";
import { missingInitialPlanningContextDimensions } from "../../../../assessment/application/services/interview-minimum-planning-context.js";

const INVESTIGATOR_TOOL_PREFIX = "engineering_rule_investigation:";
const PUBLIC_UNRESOLVED_EVIDENCE = "UNRESOLVED_EVIDENCE";
const PUBLIC_RUNTIME_ERROR = "ENGINEERING_INVESTIGATION_RUNTIME_ERROR";

type EvaluationProjection = {
  ruleId: string;
  concept: string | null;
  status: EngineeringRuleEvaluationStatus;
  reason: string | null;
  evidenceRefs: string[];
  sourceAnchors: string[];
  limitations: string[];
};

@Injectable()
export class AssessmentArtifactProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
  ) {}

  async getAvailability(
    assessmentId: string,
  ): Promise<AssessmentArtifactAvailabilityProjection> {
    const [businessContext, investigationNotes] = await Promise.all([
      this.getBusinessContext(assessmentId),
      this.getInvestigationNotes(assessmentId),
    ]);
    return {
      businessContext: withoutContent(businessContext),
      investigationNotes: withoutContent(investigationNotes),
    };
  }

  async getBusinessContext(
    assessmentId: string,
  ): Promise<BusinessContextArtifact> {
    const thread = await this.prisma.assessmentInterviewThread.findUnique({
      where: { assessmentId },
      select: {
        stateJson: true,
        contextRevision: true,
        sourceVersion: true,
        pgeVersion: true,
        updatedAt: true,
      },
    });
    const identity = {
      assessmentId,
      contextRevision: thread?.contextRevision ?? null,
      sourceVersion: thread?.sourceVersion ?? null,
      pgeVersion: thread?.pgeVersion ?? null,
    };
    if (!thread) {
      return businessContextUnavailable(
        identity,
        ASSESSMENT_ARTIFACT_STATUSES.notAvailable,
      );
    }

    const state = record(thread.stateJson);
    const candidate = state?.confirmedContext;
    if (candidate === undefined || candidate === null) {
      return businessContextUnavailable(
        identity,
        thread.contextRevision > 0
          ? ASSESSMENT_ARTIFACT_STATUSES.pending
          : ASSESSMENT_ARTIFACT_STATUSES.notAvailable,
        thread.updatedAt.toISOString(),
      );
    }
    if (!isConfirmedStructuredBusinessContext(candidate)) {
      return businessContextUnavailable(
        identity,
        ASSESSMENT_ARTIFACT_STATUSES.failed,
        thread.updatedAt.toISOString(),
      );
    }
    if (
      candidate.assessmentId !== assessmentId ||
      candidate.contextRevision !== thread.contextRevision
    ) {
      return businessContextUnavailable(
        identity,
        ASSESSMENT_ARTIFACT_STATUSES.pending,
        thread.updatedAt.toISOString(),
      );
    }

    const missing = new Set(missingInitialPlanningContextDimensions(candidate));
    const dimensions = [
      ["aiUsage", BUSINESS_CONTEXT_DIMENSIONS.aiUsage],
      ["operationalProcess", BUSINESS_CONTEXT_DIMENSIONS.operationalProcess],
      ["decisionInfluence", BUSINESS_CONTEXT_DIMENSIONS.decisionInfluence],
      ["humanOversight", BUSINESS_CONTEXT_DIMENSIONS.humanOversight],
      ["affectedSubjects", BUSINESS_CONTEXT_DIMENSIONS.affectedSubjects],
      ["dataCategories", BUSINESS_CONTEXT_DIMENSIONS.dataCategories],
    ] as const;
    const unknownDimensions: BusinessContextDimension[] = [];
    const projectedDimensions = dimensions.map(([internal, dimension]) => {
      const unknown = missing.has(internal);
      if (unknown) unknownDimensions.push(dimension);
      return {
        dimension,
        status: unknown
          ? BUSINESS_CONTEXT_DIMENSION_STATUSES.unknown
          : BUSINESS_CONTEXT_DIMENSION_STATUSES.confirmed,
      };
    });
    const statements = candidate.statements
      .map((statement) => {
        const publicStatement = sanitizePublicText(statement.statement);
        const publicTopic = sanitizePublicText(statement.topic);
        const publicScope = publicScopeSummary(statement.scope);
        if (!publicStatement || !publicTopic) return null;
        return {
          statement: publicStatement,
          topic: publicTopic,
          ...(statement.normalizedValue !== undefined
            ? {
                normalizedValue: sanitizePublicValue(statement.normalizedValue),
              }
            : {}),
          scope: publicScope,
          evidenceRefs: statement.evidenceRefs
            .map((value) => sanitizePublicText(value))
            .filter((value): value is string => Boolean(value)),
          confirmedAt: statement.createdAt,
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    return {
      type: ASSESSMENT_ARTIFACT_TYPES.businessContext,
      status: ASSESSMENT_ARTIFACT_STATUSES.ready,
      identity,
      generatedAt: thread.updatedAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      content: {
        dimensions: projectedDimensions,
        confirmedStatements: statements,
        unknownDimensions,
      },
    };
  }

  async getInvestigationNotes(
    assessmentId: string,
  ): Promise<InvestigationNotesArtifact> {
    const durable =
      await this.runtimeEvents.getLatestDurableEngineeringState(assessmentId);
    if (!durable) {
      return investigationUnavailable(
        assessmentId,
        ASSESSMENT_ARTIFACT_STATUSES.notAvailable,
      );
    }
    const { progress, plannerEvent, investigationEvents } = durable;
    const plannerAt = new Date(plannerEvent.emittedAt);
    const [
      thread,
      latestScan,
      latestReport,
      reportForRun,
      classification,
      latestRunStart,
    ] = await Promise.all([
      this.prisma.assessmentInterviewThread.findUnique({
        where: { assessmentId },
        select: { contextRevision: true },
      }),
      this.prisma.repositoryScanJob.findFirst({
        where: { assessmentId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, updatedAt: true },
      }),
      this.prisma.technicalEvidenceReport.findFirst({
        where: { assessmentId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, scanJobId: true, createdAt: true },
      }),
      this.prisma.technicalEvidenceReport.findUnique({
        where: { scanJobId: progress.runId },
        select: { id: true, snapshotId: true, createdAt: true },
      }),
      this.prisma.classificationResult.findFirst({
        where: { assessmentId, createdAt: { gte: plannerAt } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { classificationData: true, createdAt: true },
      }),
      this.runtimeEvents.getLatestAssessmentRunStart(assessmentId),
    ]);

    const identity = {
      assessmentId,
      workflowRunId: progress.runId,
      planningBatchId: progress.planningBatchId,
      contextRevisionUsed: progress.contextRevisionUsed,
      technicalEvidenceReportId: reportForRun?.id ?? null,
      snapshotId: reportForRun?.snapshotId ?? null,
    };
    const staleForNewWorkflowRun =
      latestRunStart !== null &&
      latestRunStart.runId !== progress.runId &&
      new Date(latestRunStart.emittedAt).getTime() > plannerAt.getTime();
    const staleForNewRun =
      latestScan !== null &&
      latestScan.id !== progress.runId &&
      latestScan.updatedAt.getTime() > plannerAt.getTime();
    const staleForNewEvidence =
      latestReport !== null &&
      latestReport.scanJobId !== progress.runId &&
      latestReport.createdAt.getTime() > plannerAt.getTime();
    const staleForContext =
      progress.contextRevisionUsed === null ||
      (thread !== null &&
        thread.contextRevision !== progress.contextRevisionUsed);
    if (
      staleForNewWorkflowRun ||
      staleForNewRun ||
      staleForNewEvidence ||
      staleForContext
    ) {
      return investigationUnavailable(
        assessmentId,
        ASSESSMENT_ARTIFACT_STATUSES.pending,
        identity,
        plannerEvent.emittedAt,
      );
    }

    const latestEvents = latestEventsByRule(investigationEvents);
    if (progress.planner.selectedCount > 0 && latestEvents.size === 0) {
      return investigationUnavailable(
        assessmentId,
        ASSESSMENT_ARTIFACT_STATUSES.pending,
        identity,
        plannerEvent.emittedAt,
      );
    }

    const evaluations = classificationEvaluations(
      classification?.classificationData,
    );
    const evaluationByRule = new Map(
      evaluations.map((evaluation) => [evaluation.ruleId, evaluation]),
    );
    const ruleIds = orderedRuleIds(investigationEvents, evaluations);
    const rules: InvestigationRuleNote[] = ruleIds.map((ruleId, index) => {
      const latest = latestEvents.get(ruleId) ?? null;
      const evaluation = evaluationByRule.get(ruleId) ?? null;
      const everWaited = investigationEvents.some(
        (event) =>
          ruleIdFromEvent(event) === ruleId &&
          event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
      );
      const eventOutcome = eventRuleOutcome(latest);
      const evaluationOutcome = evaluationRuleOutcome(evaluation);
      const outcome = eventOutcome ?? evaluationOutcome;
      const executionFailure = stringValue(
        record(latest?.outputSummary)?.executionFailure,
      );
      const limitations = unique([
        ...(evaluation?.limitations ?? []),
        ...(outcome === INVESTIGATION_RULE_OUTCOMES.runtimeError
          ? [
              PUBLIC_RUNTIME_ERROR,
              ...(executionFailure ? [executionFailure] : []),
            ]
          : []),
        ...(outcome === INVESTIGATION_RULE_OUTCOMES.unresolved
          ? [PUBLIC_UNRESOLVED_EVIDENCE]
          : []),
      ]).map((value) => sanitizePublicText(value) ?? value);
      return {
        key: `rule-${index + 1}`,
        title: evaluation?.concept ?? null,
        outcome,
        findingSummary: evaluation?.reason ?? null,
        evidenceRefs: evaluation?.evidenceRefs ?? [],
        sourceAnchors: evaluation?.sourceAnchors ?? [],
        limitations,
        customerContextRequested: everWaited,
        customerContextResolved:
          everWaited &&
          latest?.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runtimeFailureCode:
          outcome === INVESTIGATION_RULE_OUTCOMES.runtimeError
            ? PUBLIC_RUNTIME_ERROR
            : null,
      };
    });

    const substantive = evaluations.filter(
      (value) =>
        value.status !== ENGINEERING_RULE_EVALUATION_STATUSES.notApplicable,
    );
    const fullyEvidenceBacked =
      progress.planner.selectedCount > 0 &&
      evaluations.length >= progress.planner.selectedCount &&
      substantive.length > 0 &&
      substantive.every(
        (value) =>
          (value.status === ENGINEERING_RULE_EVALUATION_STATUSES.compliant ||
            value.status ===
              ENGINEERING_RULE_EVALUATION_STATUSES.nonCompliant) &&
          value.evidenceRefs.length > 0,
      );
    const hasEvidenceBackedNonCompliance = substantive.some(
      (value) =>
        value.status === ENGINEERING_RULE_EVALUATION_STATUSES.nonCompliant &&
        value.evidenceRefs.length > 0,
    );
    const assessmentOutcome = hasEvidenceBackedNonCompliance
      ? INVESTIGATION_ASSESSMENT_OUTCOMES.nonCompliant
      : fullyEvidenceBacked
        ? INVESTIGATION_ASSESSMENT_OUTCOMES.compliant
        : INVESTIGATION_ASSESSMENT_OUTCOMES.unknown;
    const evidenceQuality = fullyEvidenceBacked
      ? INVESTIGATION_EVIDENCE_QUALITIES.evidenceBacked
      : INVESTIGATION_EVIDENCE_QUALITIES.insufficientEvidence;
    const executionStatus =
      progress.investigator.runtimeFailedCount > 0
        ? INVESTIGATION_EXECUTION_STATUSES.interrupted
        : progress.investigator.pendingCount === 0 &&
            progress.investigator.waitingForInputCount === 0
          ? INVESTIGATION_EXECUTION_STATUSES.completed
          : INVESTIGATION_EXECUTION_STATUSES.inProgress;
    const limitations = unique([
      ...evaluations.flatMap((value) => value.limitations),
      ...(progress.investigator.domainLimitedCount > 0
        ? [PUBLIC_UNRESOLVED_EVIDENCE]
        : []),
      ...(progress.investigator.runtimeFailedCount > 0
        ? [PUBLIC_RUNTIME_ERROR]
        : []),
    ]).map((value) => sanitizePublicText(value) ?? value);
    const updatedAt =
      [
        plannerEvent.emittedAt,
        ...investigationEvents.map((event) => event.emittedAt),
        ...(classification ? [classification.createdAt.toISOString()] : []),
      ]
        .sort()
        .at(-1) ?? plannerEvent.emittedAt;

    return {
      type: ASSESSMENT_ARTIFACT_TYPES.investigationNotes,
      status: ASSESSMENT_ARTIFACT_STATUSES.ready,
      identity,
      generatedAt: plannerEvent.emittedAt,
      updatedAt,
      content: {
        summary: {
          candidateRules: progress.planner.candidateCount,
          selectedRules: progress.planner.selectedCount,
          investigatedRules: progress.investigator.completedCount,
          pendingRules: progress.investigator.pendingCount,
          waitingRules: progress.investigator.waitingForInputCount,
          domainLimitedRules: progress.investigator.domainLimitedCount,
          runtimeFailedRules: progress.investigator.runtimeFailedCount,
        },
        executionStatus,
        assessmentOutcome,
        evidenceQuality,
        rules,
        limitations,
      },
    };
  }
}

function businessContextUnavailable(
  identity: BusinessContextArtifact["identity"],
  status: BusinessContextArtifact["status"],
  updatedAt: string | null = null,
): BusinessContextArtifact {
  return {
    type: ASSESSMENT_ARTIFACT_TYPES.businessContext,
    status,
    identity,
    generatedAt: null,
    updatedAt,
    content: null,
  };
}

function investigationUnavailable(
  assessmentId: string,
  status: InvestigationNotesArtifact["status"],
  identity: InvestigationNotesArtifact["identity"] = {
    assessmentId,
    workflowRunId: null,
    planningBatchId: null,
    contextRevisionUsed: null,
    technicalEvidenceReportId: null,
    snapshotId: null,
  },
  updatedAt: string | null = null,
): InvestigationNotesArtifact {
  return {
    type: ASSESSMENT_ARTIFACT_TYPES.investigationNotes,
    status,
    identity,
    generatedAt: null,
    updatedAt,
    content: null,
  };
}

function withoutContent<
  T extends BusinessContextArtifact | InvestigationNotesArtifact,
>(artifact: T): Omit<T, "content"> {
  const { content, ...rest } = artifact;
  void content;
  return rest;
}

function classificationEvaluations(value: unknown): EvaluationProjection[] {
  const data = record(value);
  if (!data || !Array.isArray(data.evaluations)) return [];
  return data.evaluations
    .map((item) => {
      const evaluation = record(item);
      if (!evaluation) return null;
      const ruleId = stringValue(evaluation.engineering_rule_id);
      const rawStatus = stringValue(evaluation.status)?.toUpperCase();
      if (
        !ruleId ||
        !rawStatus ||
        !Object.values(ENGINEERING_RULE_EVALUATION_STATUSES).includes(
          rawStatus as EngineeringRuleEvaluationStatus,
        )
      ) {
        return null;
      }
      const concept =
        sanitizePublicText(stringValue(evaluation.concept) ?? undefined) ??
        null;
      const reason =
        sanitizePublicText(stringValue(evaluation.reason) ?? undefined) ?? null;
      return {
        ruleId,
        concept,
        status: rawStatus as EngineeringRuleEvaluationStatus,
        reason,
        evidenceRefs: publicStrings(evaluation.evidence_refs),
        sourceAnchors: publicStrings(
          evaluation.source_locators ?? evaluation.source_chunk_ids,
        ),
        limitations: publicStrings(evaluation.limitations),
      };
    })
    .filter((item): item is EvaluationProjection => item !== null);
}

function evaluationRuleOutcome(
  evaluation: EvaluationProjection | null,
): InvestigationRuleNote["outcome"] {
  switch (evaluation?.status) {
    case ENGINEERING_RULE_EVALUATION_STATUSES.compliant:
      return INVESTIGATION_RULE_OUTCOMES.requirementMet;
    case ENGINEERING_RULE_EVALUATION_STATUSES.nonCompliant:
      return INVESTIGATION_RULE_OUTCOMES.requirementNotMet;
    case ENGINEERING_RULE_EVALUATION_STATUSES.notApplicable:
      return INVESTIGATION_RULE_OUTCOMES.notApplicable;
    case ENGINEERING_RULE_EVALUATION_STATUSES.unknown:
      return INVESTIGATION_RULE_OUTCOMES.unresolved;
    default:
      return INVESTIGATION_RULE_OUTCOMES.pending;
  }
}

function eventRuleOutcome(
  event: AssessmentRuntimeActivityEvent | null,
): InvestigationRuleNote["outcome"] | null {
  if (!event) return null;
  if (event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput) {
    return INVESTIGATION_RULE_OUTCOMES.waitingForContext;
  }
  if (event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed) {
    return record(event.outputSummary)?.failureKind === "RUNTIME_ERROR"
      ? INVESTIGATION_RULE_OUTCOMES.runtimeError
      : INVESTIGATION_RULE_OUTCOMES.unresolved;
  }
  if (event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted) {
    return null;
  }
  return event.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.failed
    ? INVESTIGATION_RULE_OUTCOMES.runtimeError
    : INVESTIGATION_RULE_OUTCOMES.pending;
}

function latestEventsByRule(
  events: AssessmentRuntimeActivityEvent[],
): Map<string, AssessmentRuntimeActivityEvent> {
  const result = new Map<string, AssessmentRuntimeActivityEvent>();
  for (const event of events) {
    const ruleId = ruleIdFromEvent(event);
    if (!ruleId) continue;
    const current = result.get(ruleId);
    if (!current || event.sequence > current.sequence)
      result.set(ruleId, event);
  }
  return result;
}

function orderedRuleIds(
  events: AssessmentRuntimeActivityEvent[],
  evaluations: EvaluationProjection[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const id = ruleIdFromEvent(event);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  for (const evaluation of evaluations) {
    if (!seen.has(evaluation.ruleId)) {
      seen.add(evaluation.ruleId);
      ids.push(evaluation.ruleId);
    }
  }
  return ids;
}

function ruleIdFromEvent(event: AssessmentRuntimeActivityEvent): string | null {
  if (!event.toolName?.startsWith(INVESTIGATOR_TOOL_PREFIX)) return null;
  return event.toolName.slice(INVESTIGATOR_TOOL_PREFIX.length).trim() || null;
}

function publicStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => sanitizePublicText(item))
    .filter((item): item is string => Boolean(item));
}

function sanitizePublicValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizePublicText(value) ?? "";
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object).flatMap(([key, item]) => {
      const publicKey = sanitizePublicText(key);
      if (!publicKey || publicKey !== key) return [];
      return [[publicKey, sanitizePublicValue(item)]];
    }),
  );
}

function publicScopeSummary(scope: {
  systemRefs: readonly string[];
  componentRefs?: readonly string[];
  workflowRefs?: readonly string[];
  actorGroupRefs?: readonly string[];
  environmentRefs?: readonly string[];
  operatingRegionRefs?: readonly string[];
}): string {
  const counts = [
    ["systems", scope.systemRefs.length],
    ["components", scope.componentRefs?.length ?? 0],
    ["workflows", scope.workflowRefs?.length ?? 0],
    ["actor groups", scope.actorGroupRefs?.length ?? 0],
    ["environments", scope.environmentRefs?.length ?? 0],
    ["operating regions", scope.operatingRegionRefs?.length ?? 0],
  ] as const;
  const parts = counts
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`);
  return parts.length > 0 ? parts.join(", ") : "Assessment scope";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
