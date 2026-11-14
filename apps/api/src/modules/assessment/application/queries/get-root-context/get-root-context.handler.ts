import { HUMAN_RESOLUTION_REQUEST_STATUSES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  assessmentRootContextSchema,
  type AssessmentRootContext,
  WORKLOAD_SCOPES,
  evaluateBudgetAdmission,
  ASSESSMENT_ROOT_BOUNDARY,
} from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { HttpStatus } from "@nestjs/common";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { humanRequestDependenciesOf } from "../../../infrastructure/persistence/assessment-human-request-dependencies.js";
import {
  humanRequestHasRuleInScope,
  humanRequestScopeWhere,
} from "../../../infrastructure/persistence/assessment-human-request-scope.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { calculateConsecutiveTurnsWithoutProgress } from "../../services/assessment-progress-tracker.js";
import { GetRootContextQuery } from "./get-root-context.query.js";

function extractSavedLocale(data: unknown): string | undefined {
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const raw =
    record.responseLanguage ??
    record.response_language ??
    record.locale ??
    record.language ??
    record.lcsp_locale;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

@QueryHandler(GetRootContextQuery)
export class GetRootContextHandler implements IQueryHandler<GetRootContextQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
  ) {}

  /**
   * Business purpose: Give the leased Root pinned source scope, authorized rules and factual human feedback for its current audit.
   * Business rules:
   * - Selected membership comes from the assessment's immutable request; a missing selected request never widens to full scope.
   * - The source prefix comes from the immutable snapshot, and open human blockers must have a dependency in this audit.
   * - Human answer history remains separate from accepted facts; UNKNOWN grants no fact or compliance authority.
   * Execution flow:
   * 1. Authorize the Root and load immutable case pins and the exact selected request.
   * 2. Read authorized coverage, facts, evidence, scoped human dependencies and saved locale.
   * 3. Return the validated context with explicit source scope and current human request revisions.
   * Failure cases:
   * - Invalid lease, foreign or missing request, missing pins or malformed persisted data rejects without granting authority.
   * Side effects:
   * - Read-only transaction; creates no facts, changes no lifecycle and sends no continuation.
   */
  async execute(input: GetRootContextQuery): Promise<AssessmentRootContext> {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const auditRequest = run.auditRequestId
        ? await tx.assessmentRuleAuditRequest.findUnique({
            where: { requestId: run.auditRequestId },
            include: { rules: { orderBy: { ordinal: "asc" } } },
          })
        : null;
      if (
        run.auditRequestId &&
        (!auditRequest ||
          auditRequest.assessmentId !== input.assessmentId ||
          auditRequest.rules.length === 0)
      )
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      const selectedRuleIds = auditRequest?.rules.map(
        (rule) => rule.assessmentRuleId,
      );
      const ruleScope = selectedRuleIds ?? null;
      const [
        coverage,
        facts,
        evidence,
        humanRequests,
        currentTurn,
        latestTurn,
        latestOutbox,
        latestEvent,
      ] = await Promise.all([
        tx.assessmentDecisionCoverage.findMany({
          where: { assessmentId: input.assessmentId },
          orderBy: { assessmentRuleId: "asc" },
        }),
        tx.assessmentCaseFact.findMany({
          where: { assessmentId: input.assessmentId },
          orderBy: { caseRevision: "asc" },
          include: { evidenceLinks: { select: { evidenceId: true } } },
        }),
        tx.assessmentEvidence.findMany({
          where: { assessmentId: input.assessmentId },
          orderBy: { createdAt: "asc" },
        }),
        tx.assessmentHumanRequest.findMany({
          where: {
            ...humanRequestScopeWhere(input.assessmentId, ruleScope),
            threadId: run.threadId,
          },
          include: { dependencies: true },
          orderBy: { createdAt: "asc" },
        }),
        tx.assessmentRuntimeTurn?.findUnique
          ? tx.assessmentRuntimeTurn.findUnique({
              where: { id: run.executionId },
              select: { contextJson: true },
            })
          : Promise.resolve(null),
        tx.assessmentRuntimeTurn?.findFirst
          ? tx.assessmentRuntimeTurn.findFirst({
              where: {
                assessmentId: input.assessmentId,
                threadId: run.threadId,
              },
              orderBy: { createdAt: "desc" },
              select: { contextJson: true },
            })
          : Promise.resolve(null),
        tx.outboxMessage?.findFirst
          ? tx.outboxMessage.findFirst({
              where: {
                aggregateId: input.assessmentId,
                eventType: ASSESSMENT_ROOT_COMMAND_TYPES["ROOT_REQUESTED"],
              },
              orderBy: { createdAt: "desc" },
              select: { payload: true },
            })
          : Promise.resolve(null),
        tx.assessmentEvent?.findFirst
          ? tx.assessmentEvent.findFirst({
              where: {
                assessmentId: input.assessmentId,
                threadId: run.threadId,
              },
              orderBy: { sequence: "desc" },
              select: { payload: true },
            })
          : Promise.resolve(null),
      ]);

      const savedLocale =
        extractSavedLocale(input.responseLanguage) ??
        extractSavedLocale(currentTurn?.contextJson) ??
        extractSavedLocale(latestTurn?.contextJson) ??
        extractSavedLocale(latestOutbox?.payload) ??
        extractSavedLocale(latestEvent?.payload);

      const responseLanguage = resolveResponseLanguage(savedLocale);
      const scopedHumanRequests = humanRequests.filter((request) =>
        humanRequestHasRuleInScope(request, ruleScope),
      );

      const usageAggregate = tx.llmUsageEvent?.aggregate
        ? await tx.llmUsageEvent.aggregate({
            where: { assessmentId: input.assessmentId },
            _sum: {
              inputTokens: true,
              outputTokens: true,
              totalTokens: true,
            },
            _count: {
              id: true,
            },
          })
        : null;

      const consecutiveTurnsWithoutProgress =
        await calculateConsecutiveTurnsWithoutProgress(tx, input.assessmentId);

      const blockerRef =
        run.blockerReference &&
        typeof run.blockerReference === "object" &&
        !Array.isArray(run.blockerReference)
          ? (run.blockerReference as Record<string, unknown>)
          : {};
      const overrideNoProgress = blockerRef.overrideNoProgress === true;
      const budgetExtended = blockerRef.budgetExtended === true;

      const configuredNoProgressLimit =
        Number(process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT) > 0
          ? Number(process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT)
          : 15;

      const limits = {
        maxModelCalls:
          Number(process.env.LCSP_ASSESSMENT_MAX_MODEL_CALLS) > 0
            ? Number(process.env.LCSP_ASSESSMENT_MAX_MODEL_CALLS)
            : 100,
        maxInputTokens:
          Number(process.env.LCSP_ASSESSMENT_MAX_INPUT_TOKENS) > 0
            ? Number(process.env.LCSP_ASSESSMENT_MAX_INPUT_TOKENS)
            : 4_000_000,
        maxOutputTokens:
          Number(process.env.LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS) > 0
            ? Number(process.env.LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS)
            : 200_000,
        maxTotalTokens:
          Number(process.env.LCSP_ASSESSMENT_MAX_TOTAL_TOKENS) > 0
            ? Number(process.env.LCSP_ASSESSMENT_MAX_TOTAL_TOKENS)
            : 4_200_000,
        noProgressLimit: overrideNoProgress ? null : configuredNoProgressLimit,
      };

      const cumulativeUsage = {
        modelCalls: usageAggregate?._count?.id ?? 0,
        inputTokens: Number(usageAggregate?._sum?.inputTokens ?? 0),
        outputTokens: Number(usageAggregate?._sum?.outputTokens ?? 0),
        totalTokens: Number(usageAggregate?._sum?.totalTokens ?? 0),
        consecutiveTurnsWithoutProgress,
      };

      let admission = evaluateBudgetAdmission(limits, cumulativeUsage);
      if (budgetExtended && !admission.admitted) {
        admission = {
          admitted: true,
          reason: null,
          status: "ADMITTED",
        };
      }

      const budgetState = {
        workloadScope: WORKLOAD_SCOPES.ASSESSMENT_ROOT,
        limits,
        cumulativeUsage,
        status: admission.status,
      };

      return assessmentRootContextSchema.parse({
        assessmentId: input.assessmentId,
        threadId: run.threadId,
        lifecycleState: run.lifecycleState,
        lifecycleRevision: run.lifecycleRevision,
        caseRevision: pins.caseRevision,
        ruleSetVersionId: pins.ruleSetVersionId,
        repositorySnapshotId: pins.repositorySnapshotId,
        repositoryScanJobId: pins.repositoryScanJobId,
        repositoryCommit: pins.repositoryCommit,
        sourcePathPrefix: pins.sourcePathPrefix,
        decisionScopeId: ASSESSMENT_DECISION_SCOPE,
        auditRequest: auditRequest
          ? {
              requestId: auditRequest.requestId,
              scopeMode: auditRequest.scopeMode,
              status: auditRequest.status,
              selectedRuleIds,
            }
          : null,
        coverage: coverage
          .filter(
            (row) =>
              !selectedRuleIds ||
              selectedRuleIds.includes(row.assessmentRuleId),
          )
          .map((row) => ({
            assessmentRuleId: row.assessmentRuleId,
            assessmentRuleVersion: row.assessmentRuleVersion,
            resolutionState: row.resolutionState,
            currentDecisionId: row.currentDecisionId,
            decisionRevision: row.decisionRevision,
          })),
        facts: facts.map((fact) => ({
          factId: fact.factId,
          assessmentId: fact.assessmentId,
          caseRevision: fact.caseRevision,
          kind: fact.kind,
          authority: fact.authority,
          state: fact.state,
          statement: fact.statement,
          evidenceIds: fact.evidenceLinks.map((link) => link.evidenceId),
          createdAt: fact.createdAt.toISOString(),
        })),
        evidence: evidence.map((row) => ({
          evidenceId: row.evidenceId,
          assessmentId: row.assessmentId,
          type: row.type,
          state: row.state,
          repositoryCommit: row.repositoryCommit,
          contentSha256: row.contentSha256,
          payload: row.payload as Record<string, unknown>,
          createdAt: row.createdAt.toISOString(),
        })),
        openHumanRequestIds: scopedHumanRequests
          .filter(
            (row) => row.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          )
          .map((row) => row.requestId),
        humanRequests: scopedHumanRequests.map((row) => ({
          requestId: row.requestId,
          requestRevision: row.requestRevision,
          openedCaseRevision: row.caseRevision,
          status: row.status,
          assessmentRuleId: row.assessmentRuleId,
          criterionIds: row.criterionIds,
          question: row.question,
          unresolvedFact: row.unresolvedFact,
          decisionImpact: row.decisionImpact,
          resolutionAttempts: row.resolutionAttempts,
          controlType: row.controlType,
          choices: row.choices,
          checkpointId: row.checkpointId,
          resolvedFactId: row.resolvedFactId,
          answers: row.answers,
          dependencies: humanRequestDependenciesOf(row),
        })),
        responseLanguage,
        budgetState,
      });
    });
  }
}
