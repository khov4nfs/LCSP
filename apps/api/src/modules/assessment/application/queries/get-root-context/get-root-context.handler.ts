import { HUMAN_RESOLUTION_REQUEST_STATUSES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  assessmentRootContextSchema,
  type AssessmentRootContext,
} from "@lcsp/contracts/assessment-domain";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
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
   * Business purpose: Supply the leased Root with current pins, facts and only its authorized rule scope.
   * Business rules:
   * - Request membership comes from immutable server rows; legacy full assessments retain existing coverage.
   * Execution flow:
   * 1. Authorize the Root lease and load pinned case state.
   * 2. Read request members, accepted facts, evidence, coverage and response language.
   * 3. Filter coverage to selected members and validate the response contract.
   * Failure cases:
   * - An invalid lease or missing pins rejects the query without exposing another scope.
   * Side effects:
   * - Read-only transaction; no investigation or legal decision is created.
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
      const selectedRuleIds = auditRequest?.rules.map(
        (rule) => rule.assessmentRuleId,
      );
      const [
        coverage,
        facts,
        evidence,
        openRequests,
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
            assessmentId: input.assessmentId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
          select: { requestId: true },
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
        openHumanRequestIds: openRequests.map((row) => row.requestId),
        responseLanguage,
      });
    });
  }
}
