import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_COMPLETION_BLOCKER_CODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  RULE_AUDIT_SCOPE_MODES,
  RULE_AUDIT_STATUSES,
  assessmentCompletionGateResultSchema,
} from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentCompletionGate } from "../../services/assessment-completion-gate.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { validateRuleDecision } from "../../../domain/decision-validator.js";
import { RequestAssessmentFinalizationCommand } from "./request-assessment-finalization.command.js";

const ORCHESTRATOR = {
  id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

@CommandHandler(RequestAssessmentFinalizationCommand)
export class RequestAssessmentFinalizationHandler implements ICommandHandler<RequestAssessmentFinalizationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly completionGate: AssessmentCompletionGate,
    private readonly coordinator: AssessmentLifecycleCoordinator,
    private readonly support: AssessmentCaseSupport,
  ) {}

  /**
   * Business purpose: Confirm completion of the authorized audit scope using persisted decisions.
   * Business rules:
   * - A selected request completes when every member has a current validated decision and no open human blocker.
   * - A full request keeps the whole Rule Set completion gate and FINALIZING lifecycle transition.
   * Execution flow:
   * 1. Authorize the leased Root and load its request.
   * 2. Validate selected coverage and evidence or inspect full coverage.
   * 3. Complete the selected request or transition the full assessment when its gate has no blockers.
   * Failure cases:
   * - Missing, stale or unverified decisions return blockers; invalid leases reject transactionally.
   * Side effects:
   * - Updates selected request status or full lifecycle in one transaction; creates no fake decisions.
   */
  execute(command: RequestAssessmentFinalizationCommand) {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, {
        assessmentId: command.assessmentId,
        leaseToken: command.leaseToken,
        correlationId: command.correlationId,
        requireActive: false,
      });
      const auditRequest = run.auditRequestId
        ? await tx.assessmentRuleAuditRequest.findUnique({
            where: { requestId: run.auditRequestId },
            include: { rules: true },
          })
        : null;
      if (auditRequest?.scopeMode === RULE_AUDIT_SCOPE_MODES.SELECTED_RULES) {
        const pins = await this.support.loadPins(tx, command.assessmentId, command.correlationId);
        const blockers: Array<{ code: typeof ASSESSMENT_COMPLETION_BLOCKER_CODES[keyof typeof ASSESSMENT_COMPLETION_BLOCKER_CODES]; reference?: string }> = [];
        const open = await tx.assessmentHumanRequest.findMany({
          where: { assessmentId: command.assessmentId, status: "OPEN",
            assessmentRuleId: { in: auditRequest.rules.map((item) => item.assessmentRuleId) } },
          select: { assessmentRuleId: true },
        });
        for (const request of open) blockers.push({
          code: ASSESSMENT_COMPLETION_BLOCKER_CODES.OPEN_HUMAN_REQUEST,
          reference: request.assessmentRuleId,
        });
        for (const item of auditRequest.rules) {
          const coverage = await tx.assessmentDecisionCoverage.findUnique({
            where: { assessmentId_assessmentRuleId: {
              assessmentId: command.assessmentId, assessmentRuleId: item.assessmentRuleId,
            } }, include: { currentDecision: true },
          });
          const record = coverage?.currentDecision;
          if (!coverage || coverage.resolutionState !== DECISION_RESOLUTION_STATES.RESOLVED ||
              coverage.assessmentRuleVersion !== item.assessmentRuleVersion ||
              !record || record.state !== ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED ||
              record.caseRevision !== pins.caseRevision ||
              record.repositoryCommit !== pins.repositoryCommit ||
              record.ruleSetVersionId !== auditRequest.ruleSetVersionId) {
            blockers.push({ code: ASSESSMENT_COMPLETION_BLOCKER_CODES.DECISION_UNRESOLVED,
              reference: item.assessmentRuleId });
            continue;
          }
          const parsed = ruleDecisionSchema.safeParse(record.decision);
          if (!parsed.success || parsed.data.assessmentRuleId !== item.assessmentRuleId) {
            blockers.push({ code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
              reference: item.assessmentRuleId });
            continue;
          }
          const context = await this.support.buildValidationContext(tx, {
            assessmentId: command.assessmentId, pins, decision: parsed.data,
          });
          if (validateRuleDecision(parsed.data, context).length > 0)
            blockers.push({ code: ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION,
              reference: item.assessmentRuleId });
        }
        if (blockers.length === 0 && auditRequest.status !== RULE_AUDIT_STATUSES.COMPLETED)
          await tx.assessmentRuleAuditRequest.update({
            where: { requestId: auditRequest.requestId },
            data: { status: RULE_AUDIT_STATUSES.COMPLETED, completedAt: new Date() },
          });
        return assessmentCompletionGateResultSchema.parse({
          lifecycleState: run.lifecycleState, blockers,
        });
      }
      const inspection = await this.completionGate.inspectInTx(
        tx,
        command.assessmentId,
      );
      let lifecycleState = inspection.lifecycleState;
      if (
        inspection.blockers.length === 0 &&
        lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE
      ) {
        await this.coordinator.transitionVerifiedInTx(
          {
            assessmentId: command.assessmentId,
            expectedRevision: run.lifecycleRevision,
            toState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
            correlationId: command.correlationId,
            actorId: ORCHESTRATOR.id,
          },
          tx,
          [AGENTIC_RUNTIME_TRANSITION_GUARDS.COMPLETION_GATE_ZERO_BLOCKERS],
          ORCHESTRATOR,
        );
        lifecycleState = ASSESSMENT_LIFECYCLE_STATES.FINALIZING;
      }
      return assessmentCompletionGateResultSchema.parse({
        lifecycleState,
        blockers: inspection.blockers,
      });
    });
  }
}
