import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { assessmentHumanRequestViewSchema } from "@lcsp/contracts/assessment-domain";
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

  view(row: AssessmentHumanRequest) {
    return assessmentHumanRequestViewSchema.parse({
      requestId: row.requestId,
      requestRevision: row.requestRevision,
      openedCaseRevision: row.caseRevision,
      status: row.status,
      engineeringRuleId: row.engineeringRuleId,
      criterionIds: row.criterionIds,
      question: row.question,
      unresolvedFact: row.unresolvedFact,
      decisionImpact: row.decisionImpact,
      resolutionAttempts: row.resolutionAttempts,
      controlType: row.controlType,
      choices: row.choices,
      checkpointId: row.checkpointId,
      resolvedFactId: row.resolvedFactId,
      answers: row.answers,
    });
  }
}
