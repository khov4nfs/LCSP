import { randomUUID } from "node:crypto";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ruleDecisionSchema,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { validateRuleDecision } from "../../../domain/decision-validator.js";
import { canonicalJson, sha256Hex } from "../../../domain/domain-ids.js";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import {
  AssessmentCaseSupport,
  ROOT_AUDIT_ACTOR,
} from "../../../infrastructure/persistence/assessment-case-support.service.js";
import {
  SubmitRuleDecisionCommand,
  type SubmitRuleDecisionResult,
} from "./submit-rule-decision.command.js";

@CommandHandler(SubmitRuleDecisionCommand)
export class SubmitRuleDecisionHandler implements ICommandHandler<SubmitRuleDecisionCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
    private readonly audit: AuditWriterService,
  ) {}

  async execute(
    input: SubmitRuleDecisionCommand,
  ): Promise<SubmitRuleDecisionResult> {
    const request = input.request;
    const decision: RuleDecision = ruleDecisionSchema.parse(request.decision);
    const requestDigest = sha256Hex(canonicalJson(request));
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, input);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
        true,
      );
      await this.support.lockCase(tx, input.assessmentId);

      const replay = await tx.assessmentRuleDecision.findUnique({
        where: {
          assessmentId_idempotencyKey: {
            assessmentId: input.assessmentId,
            idempotencyKey: request.idempotencyKey,
          },
        },
      });
      if (replay) {
        if (replay.requestDigest !== requestDigest) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        return {
          decisionId: replay.decisionId,
          decisionRevision: replay.decisionRevision,
          replayed: true,
        };
      }

      const coverage = await this.support.requireCoverage(
        tx,
        input.assessmentId,
        decision.engineeringRuleId,
        input.correlationId,
      );
      const context = await this.support.buildValidationContext(tx, {
        assessmentId: input.assessmentId,
        pins,
        decision,
      });
      const failures = validateRuleDecision(decision, context);
      if (failures.length > 0) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.DECISION_VALIDATION_FAILED,
          input.correlationId,
          {
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            // Meta values are scalar; each entry is "<FAILURE_CODE>:<ref>".
            meta: {
              failures: failures
                .map((failure) => `${failure.code}:${failure.ref}`)
                .join(",")
                .slice(0, 2000),
            },
          },
        );
      }

      const previous = await tx.assessmentRuleDecision.findFirst({
        where: {
          assessmentId: input.assessmentId,
          engineeringRuleId: decision.engineeringRuleId,
          scopeId: decision.scopeId,
        },
        orderBy: { decisionRevision: "desc" },
        select: { decisionId: true, decisionRevision: true, state: true },
      });
      const latestRevision = previous?.decisionRevision ?? 0;
      if (request.expectedDecisionRevision !== latestRevision) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.DECISION_REVISION_STALE,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: { currentDecisionRevision: latestRevision },
          },
        );
      }
      if (previous?.state === ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED) {
        await tx.assessmentRuleDecision.update({
          where: { decisionId: previous.decisionId },
          data: {
            state: ASSESSMENT_DECISION_RECORD_STATES.SUPERSEDED,
            supersededAt: new Date(),
          },
        });
      }
      const decisionId = randomUUID();
      const decisionRevision = latestRevision + 1;
      await tx.assessmentRuleDecision.create({
        data: {
          decisionId,
          assessmentId: input.assessmentId,
          portfolioVersionId: pins.legalPortfolioVersionId,
          engineeringRuleId: decision.engineeringRuleId,
          engineeringRuleVersion: decision.engineeringRuleVersion,
          scopeId: decision.scopeId,
          decisionRevision,
          applicability: decision.applicability,
          compliance: decision.compliance,
          repositoryCommit: pins.repositoryCommit,
          caseRevision: pins.caseRevision,
          idempotencyKey: request.idempotencyKey,
          requestDigest,
          decision: decision,
        },
      });
      await this.support.advanceCoverageToResolved(tx, {
        assessmentId: input.assessmentId,
        engineeringRuleId: decision.engineeringRuleId,
        from: coverage.resolutionState,
        decisionId,
        decisionRevision,
      });
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.DECISION_ACCEPTED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
        executionId: run.executionId,
        payload: {
          decisionId,
          engineeringRuleId: decision.engineeringRuleId,
          decisionRevision,
        },
        auditActor: ROOT_AUDIT_ACTOR,
      });
      await this.audit.writeInTx(
        {
          eventType: ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.RULE_DECISION_ACCEPTED,
          actorId: ROOT_AUDIT_ACTOR.id,
          actor: ROOT_AUDIT_ACTOR,
          assessmentId: input.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: input.assessmentId,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            decisionId,
            engineeringRuleId: decision.engineeringRuleId,
            decisionRevision,
            applicability: decision.applicability,
          },
        },
        tx,
      );
      return { decisionId, decisionRevision, replayed: false };
    });
  }
}
