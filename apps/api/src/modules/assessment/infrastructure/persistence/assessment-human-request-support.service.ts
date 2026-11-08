import { AUTHORED_LOCALIZATION_ENTITIES } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { assessmentHumanRequestViewSchema } from "@lcsp/contracts/assessment-domain";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  Prisma,
  type AssessmentHumanRequest,
  type AssessmentHumanRequestDependency,
} from "@prisma/client";
import { humanRequestDependenciesOf } from "./assessment-human-request-dependencies.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";

import { LocalePresentationProjectionService } from "../presentation/locale-presentation-projection.service.js";

/** Owner-scoped persistence projection shared by human request reads and answers. */
@Injectable()
export class AssessmentHumanRequestSupport {
  constructor(
    private readonly projectionService: LocalePresentationProjectionService,
  ) {}

  async requireOwner(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      actor: RbacRequestContext;
      correlationId: string;
    },
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Assessment" WHERE "id" = ${input.assessmentId} FOR UPDATE`,
      );
    const assessment = await tx.assessment.findUnique({
      where: { id: input.assessmentId },
      include: { runtime: true },
    });
    if (
      !assessment ||
      input.actor.role !== AUTH_USER_ROLES.customer ||
      assessment.ownerId !== input.actor.userId
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (lock)
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "AssessmentRuntime" WHERE "assessmentId" = ${input.assessmentId} FOR UPDATE`,
      );
    return assessment;
  }

  /**
   * Business purpose: Present one factual question and all its rule dependencies in the reader's locale.
   * Business rules:
   * - Localized text never changes canonical request, answer, rule or choice identities.
   * Execution flow:
   * 1. Resolve presentation projections for customer-facing text.
   * 2. Validate the projected view including normalized dependency identities.
   * Failure cases:
   * - Invalid persisted request values fail contract parsing; unavailable translations retain canonical text.
   * Side effects:
   * - Read-only projection and translation-cache access; no assessment records are mutated.
   */
  async view(
    row: AssessmentHumanRequest & {
      dependencies?: AssessmentHumanRequestDependency[];
    },
    targetLocale?: string | null,
  ) {
    const locale = targetLocale ? resolveResponseLanguage(targetLocale) : null;
    let question = row.question;
    let unresolvedFact = row.unresolvedFact;
    let decisionImpact = row.decisionImpact;
    let resolutionAttempts = row.resolutionAttempts;
    let choices = row.choices;

    if (locale) {
      const projected = await this.projectionService.projectDocument(
        {
          question: row.question,
          unresolvedFact: row.unresolvedFact,
          ...(Array.isArray(row.decisionImpact)
            ? { decisionImpact: row.decisionImpact as string[] }
            : {}),
          ...(Array.isArray(row.resolutionAttempts)
            ? { resolutionAttempts: row.resolutionAttempts as string[] }
            : {}),
          ...(Array.isArray(row.choices)
            ? {
                choices: (
                  row.choices as Array<{ value: string; label: string }>
                ).map((choice) => ({ label: choice.label })),
              }
            : {}),
        },
        locale,
        row.assessmentId,
        {
          entityType: AUTHORED_LOCALIZATION_ENTITIES.HUMAN_REQUEST,
          entityId: row.requestId,
          canonicalRevision: String(row.requestRevision),
        },
      );

      question = projected.question;
      unresolvedFact = projected.unresolvedFact;
      if (Array.isArray(row.decisionImpact) && projected.decisionImpact) {
        decisionImpact = projected.decisionImpact;
      }
      if (
        Array.isArray(row.resolutionAttempts) &&
        projected.resolutionAttempts
      ) {
        resolutionAttempts = projected.resolutionAttempts;
      }
      if (Array.isArray(row.choices) && projected.choices) {
        const projectedChoices = projected.choices;
        choices = (row.choices as Array<{ value: string; label: string }>).map(
          (choice, index) => ({
            value: choice.value,
            label: projectedChoices[index]?.label ?? choice.label,
          }),
        );
      }
    }

    return assessmentHumanRequestViewSchema.parse({
      requestId: row.requestId,
      requestRevision: row.requestRevision,
      openedCaseRevision: row.caseRevision,
      status: row.status,
      assessmentRuleId: row.assessmentRuleId,
      criterionIds: row.criterionIds,
      dependencies: humanRequestDependenciesOf(row),
      question,
      unresolvedFact,
      decisionImpact,
      resolutionAttempts,
      controlType: row.controlType,
      choices,
      checkpointId: row.checkpointId,
      resolvedFactId: row.resolvedFactId,
      answers: row.answers,
    });
  }
}
