import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  ACCEPTED_RULE_ASSESSMENT_SCHEMA,
  deriveRuleAnalysisStatus,
  RULE_ANALYSIS_STATUSES,
  type AcceptedRuleAssessment,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaRuleAnalysisStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { rowToAcceptedRuleAssessment } from "../../mappers/rule-assessment.mapper.js";
import { PutRuleAssessmentCommand } from "./put-rule-assessment.command.js";

/**
 * Upserts one EngineeringRuleAssessment by (assessmentId, engineeringRuleId).
 * The table is the accepted-evidence ledger: a plain per-rule result store with a
 * stale-contextRevision guard, no lifecycle of its own.
 */
@CommandHandler(PutRuleAssessmentCommand)
export class PutRuleAssessmentHandler implements ICommandHandler<PutRuleAssessmentCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    command: PutRuleAssessmentCommand,
  ): Promise<AcceptedRuleAssessment> {
    const parsed = ACCEPTED_RULE_ASSESSMENT_SCHEMA.safeParse(command.body);
    if (
      !parsed.success ||
      parsed.data.assessmentId !== command.assessmentId ||
      parsed.data.engineeringRuleId !== command.engineeringRuleId
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.ruleAssessmentInvalid,
        command.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: {
            issues: parsed.success
              ? "identity"
              : parsed.error.issues
                  .slice(0, 5)
                  .map((issue) => `${issue.path.join(".")}:${issue.message}`)
                  .join("|"),
          },
        },
      );
    }
    const body = parsed.data;
    // FAILED is written only by the runtime loop; every other status must equal the
    // deterministic derivation from the criteria.
    if (
      body.status !== RULE_ANALYSIS_STATUSES.failed &&
      body.status !== deriveRuleAnalysisStatus(body.criteria)
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.ruleAssessmentInvalid,
        command.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: { issues: "status:does not match criteria" },
        },
      );
    }
    const provenanceMismatch = body.criteria.some((criterion) =>
      criterion.evidence.some(
        (item) =>
          item.provenance.assessmentId !== body.assessmentId ||
          item.provenance.engineeringRuleId !== body.engineeringRuleId ||
          item.provenance.repositoryVersion !== body.repositoryVersion ||
          item.provenance.criterionId !== criterion.criterionId ||
          !criterion.evidenceRefs.includes(item.ref),
      ),
    );
    if (provenanceMismatch) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.ruleAssessmentInvalid,
        command.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: { issues: "evidence.provenance:identity mismatch" },
        },
      );
    }
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: command.assessmentId },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const data = {
      engineeringRuleVersion: body.engineeringRuleVersion,
      repositoryVersion: body.repositoryVersion,
      contextRevision: body.contextRevision,
      status: toPrismaRuleAnalysisStatus(body.status),
      resultId: body.resultId,
      criteria: body.criteria as unknown as Prisma.InputJsonValue,
      limitations: body.limitations,
      execution: body.execution as unknown as Prisma.InputJsonValue,
      attempt: body.execution.attempt,
    };
    const where = {
      assessmentId_engineeringRuleId: {
        assessmentId: command.assessmentId,
        engineeringRuleId: command.engineeringRuleId,
      },
    };
    const existing = await this.prisma.engineeringRuleAssessment.findUnique({
      where,
    });
    if (existing && body.contextRevision < existing.contextRevision) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.ruleAssessmentStale,
        command.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: {
            storedContextRevision: existing.contextRevision,
            incomingContextRevision: body.contextRevision,
          },
        },
      );
    }
    if (!existing) {
      // First write: the unique (assessmentId, engineeringRuleId) key makes create atomic.
      // Losing a concurrent first-write race (P2002) falls through to the guarded CAS below.
      try {
        const created = await this.prisma.engineeringRuleAssessment.create({
          data: {
            assessmentId: command.assessmentId,
            engineeringRuleId: command.engineeringRuleId,
            ...data,
          },
        });
        return rowToAcceptedRuleAssessment(created);
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        ) {
          throw error;
        }
      }
    }
    // Compare-and-set on contextRevision: a newer stored revision is never overwritten.
    const updated = await this.prisma.engineeringRuleAssessment.updateMany({
      where: {
        assessmentId: command.assessmentId,
        engineeringRuleId: command.engineeringRuleId,
        contextRevision: { lte: body.contextRevision },
      },
      data,
    });
    if (updated.count !== 1) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.ruleAssessmentStale,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const saved = await this.prisma.engineeringRuleAssessment.findUniqueOrThrow(
      {
        where,
      },
    );
    return rowToAcceptedRuleAssessment(saved);
  }
}
