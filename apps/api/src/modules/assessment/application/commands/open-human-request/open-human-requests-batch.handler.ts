import { randomUUID } from "node:crypto";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  BLOCKER_REASONS,
  assessmentBlockerSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  HUMAN_RESOLUTION_CONTROL_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_RECORD_STATES,
  type OpenAssessmentHumanRequestResult,
  type OpenAssessmentHumanRequestsBatchResult,
} from "@lcsp/contracts/assessment-domain";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { isCustomerSafe } from "../../../domain/customer-safe-text.js";
import { criterionIdsOf } from "../../../domain/rule-criteria.js";
import { canonicalJson, sha256Hex } from "../../../domain/domain-ids.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import {
  AssessmentCaseSupport,
  ROOT_AUDIT_ACTOR,
  invalid,
} from "../../../infrastructure/persistence/assessment-case-support.service.js";
import {
  canonicalHumanRequestDependencies,
  hasSameHumanFactScope,
  humanRequestDependenciesOf,
} from "../../../infrastructure/persistence/assessment-human-request-dependencies.js";
import { OpenHumanRequestsBatchCommand } from "./open-human-requests-batch.command.js";

@CommandHandler(OpenHumanRequestsBatchCommand)
export class OpenHumanRequestsBatchHandler implements ICommandHandler<OpenHumanRequestsBatchCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
    private readonly audit: AuditWriterService,
    private readonly coordinator: AssessmentLifecycleCoordinator,
  ) {}

  /**
   * Business purpose: Ask multiple material factual questions atomically with a single batch registration and transition.
   *
   * Business rules:
   * - Every declared dependency in each batch request must belong to the active audit's authorized rule scope.
   * - All batch requests must target the exact pinned case revision; revision mismatch rejects the entire batch.
   * - Each request is verified for anchor validity (criterion or condition), customer-safe text, and control type consistency.
   * - If any request is an open blocker and the assessment is currently ACTIVE, transition to WAITING_FOR_HUMAN occurs once.
   * - Replayed requests with matching idempotency return identical request identities without duplicate creation.
   *
   * Execution flow:
   * 1. Authorize the agent lease and load pins under a single transaction.
   * 2. Lock the assessment case and verify the case revision against every request.
   * 3. For each request, check idempotency receipts, validate criteria and customer-safe text, and persist or link dependencies.
   * 4. Move affected coverage rows to WAITING_FOR_INPUT.
   * 5. If at least one request remains open and the assessment is ACTIVE, transition to WAITING_FOR_HUMAN once.
   * 6. Return the array of open request results.
   *
   * Failure cases:
   * - Stale case revisions, unauthorized dependencies, unsafe wording, or conflicting idempotency keys reject the batch atomically.
   *
   * Side effects:
   * - Atomically persists human requests, dependency links, coverage state updates, audit records, and events; creates no compliance verdicts.
   */
  async execute(
    input: OpenHumanRequestsBatchCommand,
  ): Promise<OpenAssessmentHumanRequestsBatchResult> {
    const requests = input.batch.requests;
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });

      const blocker = assessmentBlockerSchema.safeParse({
        reason: run.blockerReason,
        reference: run.blockerReference,
      });
      const blockedHumanWait =
        run.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
        blocker.success &&
        blocker.data.reason === BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE;
      if (
        ![
          ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
        ].some((state) => state === run.lifecycleState) &&
        !blockedHumanWait
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      await this.support.lockCase(tx, input.assessmentId);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
        true,
      );

      const results: OpenAssessmentHumanRequestResult[] = [];
      let hasWaiting = false;

      // Phase 1: Pre-validation of all requests in batch before performing writes
      type ValidatedItem = {
        request: (typeof requests)[number];
        dependencies: ReturnType<typeof canonicalHumanRequestDependencies>;
        requestDigest: string;
        coverageRows: Map<
          string,
          Awaited<ReturnType<AssessmentCaseSupport["requireCoverage"]>>
        >;
        source: Prisma.AssessmentHumanRequestGetPayload<{
          include: { dependencies: true };
        }> | null;
      };
      const validatedItems: ValidatedItem[] = [];

      for (const request of requests) {
        const dependencies = canonicalHumanRequestDependencies(
          {
            assessmentRuleId: request.assessmentRuleId,
            criterionIds: request.criterionIds,
          },
          request.dependencies,
        );
        for (const dependency of dependencies) {
          await this.authority.requireSelectedRuleMembershipInTx(
            tx,
            run,
            dependency.assessmentRuleId,
            input.correlationId,
          );
        }

        const {
          expectedCaseRevision: _revision,
          idempotencyKey: _key,
          ...content
        } = request;
        void _revision;
        void _key;
        const requestDigest = sha256Hex(canonicalJson(content));

        if (pins.caseRevision !== request.expectedCaseRevision) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CASE_REVISION_STALE,
            input.correlationId,
            {
              status: HttpStatus.CONFLICT,
              meta: { currentCaseRevision: pins.caseRevision },
            },
          );
        }

        const coverageRows = new Map<
          string,
          Awaited<ReturnType<AssessmentCaseSupport["requireCoverage"]>>
        >();
        for (const dependency of dependencies) {
          const coverage = await this.support.requireCoverage(
            tx,
            input.assessmentId,
            dependency.assessmentRuleId,
            input.correlationId,
          );
          coverageRows.set(dependency.assessmentRuleId, coverage);
          const rule = await tx.assessmentRule.findUniqueOrThrow({
            where: {
              ruleSetVersionId_assessmentRuleId: {
                ruleSetVersionId: pins.ruleSetVersionId,
                assessmentRuleId: dependency.assessmentRuleId,
              },
            },
            select: { criteria: true },
          });
          const knownCriteria = new Set(criterionIdsOf(rule.criteria));
          if (dependency.criterionIds.some((id) => !knownCriteria.has(id))) {
            throw invalid(
              ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
              input.correlationId,
            );
          }
        }

        const choiceValues = request.choices.map((choice) => choice.value);
        if (
          !Object.values(HUMAN_RESOLUTION_CONTROL_TYPES).some(
            (type) => type === request.controlType,
          ) ||
          (request.controlType ===
            HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT &&
            request.choices.length === 0) ||
          (request.controlType === HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT &&
            request.choices.length > 0) ||
          new Set(choiceValues).size !== choiceValues.length ||
          !isCustomerSafe(
            [
              request.question,
              request.unresolvedFact,
              ...request.choices.map((c) => c.label),
            ],
            await this.support.ruleSetIdentifiers(tx, pins.ruleSetVersionId),
          )
        ) {
          throw invalid(
            ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
            input.correlationId,
          );
        }

        const source = request.sourceRequestId
          ? await tx.assessmentHumanRequest.findFirst({
              where: {
                assessmentId: input.assessmentId,
                requestId: request.sourceRequestId,
              },
              include: { dependencies: true },
            })
          : null;
        if (
          request.sourceRequestId &&
          (!source ||
            source.threadId !== run.threadId ||
            ![
              HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
              HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
            ].some((status) => status === source.status) ||
            !hasSameHumanFactScope(source, request) ||
            (source.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN &&
              source.caseRevision !== pins.caseRevision))
        ) {
          throw invalid(
            ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
            input.correlationId,
          );
        }
        if (source?.status === HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED) {
          const fact = source.resolvedFactId
            ? await tx.assessmentCaseFact.findFirst({
                where: {
                  assessmentId: input.assessmentId,
                  factId: source.resolvedFactId,
                },
                include: { evidenceLinks: { include: { evidence: true } } },
              })
            : null;
          if (
            !fact ||
            fact.state !== ASSESSMENT_RECORD_STATES.ACCEPTED ||
            fact.authority !== ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED ||
            fact.caseRevision > pins.caseRevision ||
            fact.caseRevision <= source.caseRevision ||
            fact.evidenceLinks.length === 0 ||
            fact.evidenceLinks.some(
              ({ evidence }) =>
                evidence.type !== ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER ||
                evidence.assessmentId !== input.assessmentId ||
                evidence.state !== ASSESSMENT_RECORD_STATES.ACCEPTED ||
                evidence.repositoryCommit !== pins.repositoryCommit,
            )
          ) {
            throw invalid(
              ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_REFERENCE_INVALID,
              input.correlationId,
            );
          }
        }

        validatedItems.push({
          request,
          dependencies,
          requestDigest,
          coverageRows,
          source,
        });
      }

      // Phase 2: Persistence and state mutation
      for (const item of validatedItems) {
        const { request, dependencies, requestDigest, coverageRows, source } =
          item;

        const receipt = await tx.assessmentHumanRequestRegistration.findUnique({
          where: {
            assessmentId_idempotencyKey: {
              assessmentId: input.assessmentId,
              idempotencyKey: request.idempotencyKey,
            },
          },
        });
        if (receipt) {
          if (receipt.requestDigest !== requestDigest) {
            throw problemException(
              ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
              input.correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }
          results.push({
            requestId: receipt.requestId,
            caseRevision: receipt.caseRevision,
            requestRevision: receipt.requestRevision,
          });
          continue;
        }

        const replay = await tx.assessmentHumanRequest.findUnique({
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
          results.push({
            requestId: replay.requestId,
            caseRevision: replay.caseRevision,
            requestRevision: replay.requestRevision,
          });
          continue;
        }

        const previousDependencies = source
          ? humanRequestDependenciesOf(source)
          : [];
        const affectedDependencies = dependencies.filter((dependency) => {
          const previous = previousDependencies.find(
            (entry) => entry.assessmentRuleId === dependency.assessmentRuleId,
          );
          return (
            !previous ||
            dependency.criterionIds.some(
              (id) => !previous.criterionIds.includes(id),
            )
          );
        });

        const requestId = source?.requestId ?? randomUUID();
        const waiting =
          !source || source.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN;
        if (waiting) {
          hasWaiting = true;
        }

        for (const dependency of affectedDependencies) {
          const coverage = coverageRows.get(dependency.assessmentRuleId)!;
          if (
            coverage.resolutionState === DECISION_RESOLUTION_STATES.RESOLVED
          ) {
            await tx.assessmentRuleDecision.updateMany({
              where: {
                assessmentId: input.assessmentId,
                assessmentRuleId: dependency.assessmentRuleId,
                state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
              },
              data: {
                state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
                invalidatedAt: new Date(),
              },
            });
            await tx.assessmentDecisionCoverage.update({
              where: {
                assessmentId_assessmentRuleId: {
                  assessmentId: input.assessmentId,
                  assessmentRuleId: dependency.assessmentRuleId,
                },
              },
              data: { resolutionState: DECISION_RESOLUTION_STATES.INVALIDATED },
            });
            coverage.resolutionState = DECISION_RESOLUTION_STATES.INVALIDATED;
          }
          if (waiting) {
            await this.support.moveCoverageToWaiting(tx, {
              assessmentId: input.assessmentId,
              assessmentRuleId: dependency.assessmentRuleId,
              from: coverage.resolutionState,
            });
          } else if (
            coverage.resolutionState === DECISION_RESOLUTION_STATES.PENDING ||
            coverage.resolutionState === DECISION_RESOLUTION_STATES.INVALIDATED
          ) {
            await tx.assessmentDecisionCoverage.update({
              where: {
                assessmentId_assessmentRuleId: {
                  assessmentId: input.assessmentId,
                  assessmentRuleId: dependency.assessmentRuleId,
                },
              },
              data: {
                resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING,
              },
            });
          }
        }

        if (!source) {
          await tx.assessmentHumanRequest.create({
            data: {
              requestId,
              assessmentId: input.assessmentId,
              threadId: run.threadId,
              caseRevision: pins.caseRevision,
              assessmentRuleId: request.assessmentRuleId,
              criterionIds: request.criterionIds,
              question: request.question,
              unresolvedFact: request.unresolvedFact,
              decisionImpact: request.decisionImpact,
              resolutionAttempts: request.resolutionAttempts,
              controlType: request.controlType,
              choices: request.choices,
              idempotencyKey: request.idempotencyKey,
              requestDigest,
            },
          });
        }

        for (const dependency of dependencies) {
          const previous = previousDependencies.find(
            (entry) => entry.assessmentRuleId === dependency.assessmentRuleId,
          );
          const criterionIds = [
            ...new Set([
              ...(previous?.criterionIds ?? []),
              ...dependency.criterionIds,
            ]),
          ].sort();
          await tx.assessmentHumanRequestDependency.upsert({
            where: {
              requestId_assessmentRuleId: {
                requestId,
                assessmentRuleId: dependency.assessmentRuleId,
              },
            },
            create: {
              requestId,
              assessmentId: input.assessmentId,
              ...dependency,
              criterionIds,
            },
            update: { criterionIds },
          });
        }

        const result = {
          requestId,
          caseRevision: pins.caseRevision,
          requestRevision: source?.requestRevision ?? 0,
        };
        await tx.assessmentHumanRequestRegistration.create({
          data: {
            assessmentId: input.assessmentId,
            idempotencyKey: request.idempotencyKey,
            requestDigest,
            ...result,
          },
        });

        if (!source) {
          await this.events.appendInTx(tx, {
            assessmentId: input.assessmentId,
            correlationId: input.correlationId,
            eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED,
            actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
            executionId: run.executionId,
            payload: {
              requestId,
              fromStatus: null,
              toStatus: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
              caseRevision: pins.caseRevision,
            },
            auditActor: ROOT_AUDIT_ACTOR,
          });
        }

        await this.audit.writeInTx(
          {
            eventType: ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_REQUEST_OPENED,
            actorId: ROOT_AUDIT_ACTOR.id,
            actor: ROOT_AUDIT_ACTOR,
            assessmentId: input.assessmentId,
            resourceType: AUDIT_RESOURCE_TYPES.assessment,
            resourceId: input.assessmentId,
            decision: AUDIT_DECISIONS.allow,
            correlationId: input.correlationId,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            payload: {
              requestId,
              assessmentRuleId: request.assessmentRuleId,
              dependencies,
              sourceRequestId: request.sourceRequestId ?? null,
            },
          },
          tx,
        );

        results.push(result);
      }

      if (
        hasWaiting &&
        run.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE
      ) {
        await this.coordinator.transitionVerifiedInTx(
          {
            assessmentId: input.assessmentId,
            expectedRevision: run.lifecycleRevision,
            toState: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
            correlationId: input.correlationId,
            actorId: ROOT_AUDIT_ACTOR.id,
          },
          tx,
          [AGENTIC_RUNTIME_TRANSITION_GUARDS.OPEN_MATERIAL_HUMAN_REQUEST],
          ROOT_AUDIT_ACTOR,
        );
      }

      return { requests: results };
    });
  }
}
