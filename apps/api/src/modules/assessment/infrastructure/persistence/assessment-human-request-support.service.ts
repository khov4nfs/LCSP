import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { assessmentHumanRequestViewSchema } from "@lcsp/contracts/assessment-domain";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type AssessmentHumanRequest } from "@prisma/client";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";

const presentationProjectionCache = new Map<string, string>();

export function getPresentationProjection(
  text: string,
  locale: string,
): string | undefined {
  return presentationProjectionCache.get(`${locale}:${text}`);
}

export function registerPresentationProjection(
  text: string,
  locale: string,
  projectedText: string,
): void {
  presentationProjectionCache.set(`${locale}:${text}`, projectedText);
}

export function clearPresentationProjections(): void {
  presentationProjectionCache.clear();
}

/** Owner-scoped persistence projection shared by human request reads and answers. */
@Injectable()
export class AssessmentHumanRequestSupport {
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

  view(row: AssessmentHumanRequest, targetLocale?: string | null) {
    const locale = targetLocale ? resolveResponseLanguage(targetLocale) : null;
    let question = row.question;
    let unresolvedFact = row.unresolvedFact;
    let decisionImpact = row.decisionImpact;
    let resolutionAttempts = row.resolutionAttempts;
    let choices = row.choices;

    if (locale) {
      question =
        getPresentationProjection(row.question, locale) ?? row.question;
      unresolvedFact =
        getPresentationProjection(row.unresolvedFact, locale) ??
        row.unresolvedFact;
      if (Array.isArray(row.decisionImpact)) {
        decisionImpact = (row.decisionImpact as string[]).map(
          (impact) => getPresentationProjection(impact, locale) ?? impact,
        );
      }
      if (Array.isArray(row.resolutionAttempts)) {
        resolutionAttempts = (row.resolutionAttempts as string[]).map(
          (attempt) => getPresentationProjection(attempt, locale) ?? attempt,
        );
      }
      if (Array.isArray(row.choices)) {
        choices = (row.choices as Array<{ value: string; label: string }>).map(
          (choice) => ({
            value: choice.value,
            label:
              getPresentationProjection(choice.label, locale) ?? choice.label,
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
