import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_LIFECYCLE_STATES,
  BLOCKER_REASONS,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  assessmentBlockerSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_RECORD_STATES,
  type ReportUnresolvableHumanFactResult,
} from "@lcsp/contracts/assessment-domain";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { canonicalJson, sha256Hex } from "../../../domain/domain-ids.js";
import {
  AssessmentCaseSupport,
  ROOT_AUDIT_ACTOR,
} from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { ReportUnresolvableHumanFactCommand } from "./report-unresolvable-human-fact.command.js";

/** The Root decides permanent obtainability; the API verifies request, revision and evidence. */
@CommandHandler(ReportUnresolvableHumanFactCommand)
export class ReportUnresolvableHumanFactHandler implements ICommandHandler<ReportUnresolvableHumanFactCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly coordinator: AssessmentLifecycleCoordinator,
    private readonly audit: AuditWriterService,
  ) {}

  execute(
    input: ReportUnresolvableHumanFactCommand,
  ): Promise<ReportUnresolvableHumanFactResult> {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      const body = input.request;
      const reject = (code: string) =>
        problemException(code, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      const request = await tx.assessmentHumanRequest.findFirst({
        where: {
          assessmentId: input.assessmentId,
          requestId: body.humanResolutionRequestId,
        },
      });
      if (!request || request.threadId !== run.threadId)
        throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_NOT_FOUND);
      if (request.status !== HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN)
        throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_CLOSED);
      if (request.requestRevision !== body.expectedRequestRevision)
        throw reject(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_REVISION_STALE,
        );
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
        true,
      );
      if (pins.caseRevision !== body.expectedCaseRevision)
        throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.CASE_REVISION_STALE);
      const evidenceIds = [...new Set(body.evidenceIds)].sort();
      const evidence = await tx.assessmentEvidence.findMany({
        where: {
          assessmentId: input.assessmentId,
          evidenceId: { in: evidenceIds },
        },
      });
      if (
        evidence.length !== evidenceIds.length ||
        evidence.some(
          (item) =>
            item.state !== ASSESSMENT_RECORD_STATES.ACCEPTED ||
            item.repositoryCommit !== pins.repositoryCommit,
        )
      )
        throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_REFERENCE_INVALID);
      const claimDigest = sha256Hex(
        canonicalJson({
          requestId: request.requestId,
          rationale: body.rationale,
          evidenceIds,
        }),
      );
      const blocker = assessmentBlockerSchema.safeParse({
        reason: run.blockerReason,
        reference: run.blockerReference,
      });
      if (
        run.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
        blocker.success &&
        blocker.data.reason === BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE
      ) {
        const receipt = await tx.auditEvent.findFirst({
          where: {
            resourceId: input.assessmentId,
            eventType:
              ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_FACT_UNRESOLVABLE_REPORTED,
            payload: { path: ["requestId"], equals: request.requestId },
          },
          select: { payload: true },
        });
        const payload = receipt?.payload;
        if (
          receipt &&
          (!payload ||
            typeof payload !== "object" ||
            Array.isArray(payload) ||
            payload.claimDigest !== claimDigest)
        )
          throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT);
        if (receipt)
          return {
            requestId: request.requestId,
            caseRevision: pins.caseRevision,
            lifecycleState: ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
            replayed: true,
          };
      }
      const alreadyHumanBlocked =
        run.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
        blocker.success &&
        blocker.data.reason === BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE;
      if (
        run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN &&
        !alreadyHumanBlocked
      )
        throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE);
      // Retain one canonical reference while every open checkpoint request remains blocking.
      if (!alreadyHumanBlocked)
        await this.coordinator.transitionVerifiedInTx(
          {
            assessmentId: input.assessmentId,
            expectedRevision: run.lifecycleRevision,
            toState: ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
            blocker: {
              reason: BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE,
              reference: { humanResolutionRequestId: request.requestId },
            },
            correlationId: input.correlationId,
            actorId: ROOT_AUDIT_ACTOR.id,
          },
          tx,
          [
            AGENTIC_RUNTIME_TRANSITION_GUARDS.DEPENDENCY_PERMANENTLY_UNOBTAINABLE,
          ],
          ROOT_AUDIT_ACTOR,
        );
      await this.audit.writeInTx(
        {
          eventType:
            ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_FACT_UNRESOLVABLE_REPORTED,
          actorId: ROOT_AUDIT_ACTOR.id,
          actor: ROOT_AUDIT_ACTOR,
          assessmentId: input.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: input.assessmentId,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            requestId: request.requestId,
            claimDigest,
            rationale: body.rationale,
            evidenceIds,
          },
        },
        tx,
      );
      return {
        requestId: request.requestId,
        caseRevision: pins.caseRevision,
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
        replayed: false,
      };
    });
  }
}
