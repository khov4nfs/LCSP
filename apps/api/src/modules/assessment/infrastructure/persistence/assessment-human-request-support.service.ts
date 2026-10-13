import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { assessmentHumanRequestViewSchema } from "@lcsp/contracts/assessment-domain";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type AssessmentHumanRequest } from "@prisma/client";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";

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

    if (
      locale &&
      row.displayLocales &&
      typeof row.displayLocales === "object" &&
      !Array.isArray(row.displayLocales)
    ) {
      const displayMap = row.displayLocales as Record<string, unknown>;
      const localized = displayMap[locale];
      if (
        localized &&
        typeof localized === "object" &&
        !Array.isArray(localized)
      ) {
        const entry = localized as Record<string, unknown>;
        if (
          typeof entry.question === "string" &&
          entry.question.trim().length > 0
        ) {
          question = entry.question;
        }
        if (
          typeof entry.unresolvedFact === "string" &&
          entry.unresolvedFact.trim().length > 0
        ) {
          unresolvedFact = entry.unresolvedFact;
        }
        if (
          Array.isArray(entry.decisionImpact) &&
          entry.decisionImpact.length > 0
        ) {
          decisionImpact = entry.decisionImpact as typeof row.decisionImpact;
        }
        if (
          Array.isArray(entry.resolutionAttempts) &&
          entry.resolutionAttempts.length > 0
        ) {
          resolutionAttempts =
            entry.resolutionAttempts as typeof row.resolutionAttempts;
        }
        if (Array.isArray(entry.choices) && entry.choices.length > 0) {
          choices = entry.choices as typeof row.choices;
        }
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
      sourceLocale: row.sourceLocale ?? "en",
      displayLocales: (row.displayLocales as Record<string, any>) ?? undefined,
    });
  }
}
