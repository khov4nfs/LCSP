import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_ACTIVITY_KINDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_RECORD_STATES,
} from "@lcsp/contracts/assessment-domain";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  canonicalJson,
  deterministicUuid,
} from "../../../domain/domain-ids.js";
import { AssessmentEvidenceInvalidation } from "../../services/assessment-evidence-invalidation.service.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import {
  AssessmentCaseSupport,
  ROOT_AUDIT_ACTOR,
} from "../../../infrastructure/persistence/assessment-case-support.service.js";
import {
  AcceptAssessmentFactCommand,
  type AcceptAssessmentFactResult,
} from "./accept-assessment-fact.command.js";

@CommandHandler(AcceptAssessmentFactCommand)
export class AcceptAssessmentFactHandler implements ICommandHandler<AcceptAssessmentFactCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
    private readonly invalidation: AssessmentEvidenceInvalidation,
  ) {}

  async execute(
    input: AcceptAssessmentFactCommand,
  ): Promise<AcceptAssessmentFactResult> {
    const request = input.request;
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, input);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
        true,
      );
      const evidenceIds = [...new Set(request.evidenceIds)].sort();
      const factId = deterministicUuid(
        `${input.assessmentId}:${canonicalJson({ kind: request.kind, statement: request.statement, evidenceIds })}`,
      );
      await this.support.lockCase(tx, input.assessmentId);
      const current = await tx.assessmentCase.findUniqueOrThrow({
        where: { assessmentId: input.assessmentId },
        select: { caseRevision: true },
      });
      const replay = await tx.assessmentCaseFact.findUnique({
        where: { factId },
      });
      if (replay && replay.state === ASSESSMENT_RECORD_STATES.ACCEPTED) {
        return { factId, caseRevision: current.caseRevision };
      }
      if (replay) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_REFERENCE_INVALID,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      if (current.caseRevision !== request.expectedCaseRevision) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.CASE_REVISION_STALE,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: { currentCaseRevision: current.caseRevision },
          },
        );
      }
      const evidence = await tx.assessmentEvidence.findMany({
        where: {
          assessmentId: input.assessmentId,
          evidenceId: { in: evidenceIds },
        },
        select: { evidenceId: true, state: true, repositoryCommit: true },
      });
      const accepted = evidence.filter(
        (row) =>
          row.state === ASSESSMENT_RECORD_STATES.ACCEPTED &&
          row.repositoryCommit === pins.repositoryCommit,
      );
      if (accepted.length !== evidenceIds.length) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_REFERENCE_INVALID,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      const revision = current.caseRevision + 1;
      await tx.assessmentCase.update({
        where: { assessmentId: input.assessmentId },
        data: { caseRevision: revision },
      });
      await this.invalidation.invalidateCaseRevisionInTx(
        tx,
        input.assessmentId,
        revision,
      );
      await tx.assessmentCaseFact.create({
        data: {
          factId,
          assessmentId: input.assessmentId,
          caseRevision: revision,
          kind: request.kind,
          authority: ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED,
          statement: request.statement,
        },
      });
      await tx.assessmentCaseFactEvidence.createMany({
        data: evidenceIds.map((evidenceId) => ({
          assessmentId: input.assessmentId,
          factId,
          evidenceId,
        })),
      });
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
        executionId: run.executionId,
        payload: {
          kind: ASSESSMENT_ACTIVITY_KINDS.DOMAIN,
          labelKey: ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS.FACT_ACCEPTED,
        },
        auditActor: ROOT_AUDIT_ACTOR,
      });
      return { factId, caseRevision: revision };
    });
  }
}
