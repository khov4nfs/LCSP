import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { assessmentHumanRequestViewSchema } from "@lcsp/contracts/assessment-domain";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type AssessmentHumanRequest } from "@prisma/client";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";

import {
  LocalePresentationProjectionService,
  getPresentationProjection,
  registerPresentationProjection,
  clearPresentationProjections,
} from "../presentation/locale-presentation-projection.service.js";

export {
  getPresentationProjection,
  registerPresentationProjection,
  clearPresentationProjections,
};

/** Owner-scoped persistence projection shared by human request reads and answers. */
@Injectable()
export class AssessmentHumanRequestSupport {
  constructor(
    private readonly projectionService: LocalePresentationProjectionService = new LocalePresentationProjectionService(),
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

  async view(row: AssessmentHumanRequest, targetLocale?: string | null) {
    const locale = targetLocale ? resolveResponseLanguage(targetLocale) : null;
    let question = row.question;
    let unresolvedFact = row.unresolvedFact;
    let decisionImpact = row.decisionImpact;
    let resolutionAttempts = row.resolutionAttempts;
    let choices = row.choices;

    if (locale) {
      const textsToProject: string[] = [row.question, row.unresolvedFact];
      if (Array.isArray(row.decisionImpact)) {
        textsToProject.push(...(row.decisionImpact as string[]));
      }
      if (Array.isArray(row.resolutionAttempts)) {
        textsToProject.push(...(row.resolutionAttempts as string[]));
      }
      if (Array.isArray(row.choices)) {
        textsToProject.push(
          ...(row.choices as Array<{ value: string; label: string }>).map(
            (choice) => choice.label,
          ),
        );
      }

      const projections = await this.projectionService.projectBatch(
        textsToProject,
        locale,
      );

      question = projections.get(row.question) ?? row.question;
      unresolvedFact =
        projections.get(row.unresolvedFact) ?? row.unresolvedFact;
      if (Array.isArray(row.decisionImpact)) {
        decisionImpact = (row.decisionImpact as string[]).map(
          (impact) => projections.get(impact) ?? impact,
        );
      }
      if (Array.isArray(row.resolutionAttempts)) {
        resolutionAttempts = (row.resolutionAttempts as string[]).map(
          (attempt) => projections.get(attempt) ?? attempt,
        );
      }
      if (Array.isArray(row.choices)) {
        choices = (row.choices as Array<{ value: string; label: string }>).map(
          (choice) => ({
            value: choice.value,
            label: projections.get(choice.label) ?? choice.label,
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
