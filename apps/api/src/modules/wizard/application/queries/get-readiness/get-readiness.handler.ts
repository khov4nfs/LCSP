import { WIZARD_STATUS_CODES } from "@lcsp/contracts/assessment";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { type WizardAnswer } from "@lcsp/contracts/wizard";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  fromPrismaWizardStatus,
  toPrismaEvidenceAcceptanceStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentNotFoundException } from "../../../domain/exceptions/wizard.exceptions.js";
import type { ReadinessResponse } from "../../contracts/wizard/readiness.contract.js";
import { ReadinessEvaluatorService } from "../../services/wizard/readiness-evaluator.service.js";
import { GetReadinessQuery } from "./get-readiness.query.js";

@QueryHandler(GetReadinessQuery)
export class GetReadinessHandler implements IQueryHandler<
  GetReadinessQuery,
  ReadinessResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readinessEvaluator: ReadinessEvaluatorService,
  ) {}

  async execute(query: GetReadinessQuery): Promise<ReadinessResponse> {
    const { assessmentId } = query;

    // Verify assessment exists.
    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: assessmentId,
      },
    });

    if (!assessment) {
      throw new AssessmentNotFoundException(query.correlationId);
    }

    // Run parallel checks for related states
    const [wizardProfile, repositorySnapshot, evidenceReport] =
      await Promise.all([
        this.prisma.wizardProfile.findUnique({
          where: { assessmentId },
        }),
        this.prisma.repositorySnapshot.findFirst({
          where: { assessmentId },
        }),
        this.prisma.technicalEvidenceReport.findFirst({
          where: {
            assessmentId,
            status: toPrismaEvidenceAcceptanceStatus(
              TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
            ),
          },
        }),
      ]);

    const wizardStatus = wizardProfile
      ? fromPrismaWizardStatus(wizardProfile.status)
      : WIZARD_STATUS_CODES.notStarted;

    // Evaluate readiness logic
    const evaluation = this.readinessEvaluator.evaluate({
      hasRepositoryConnection: !!repositorySnapshot,
      hasAcceptedTechnicalEvidence: !!evidenceReport,
      wizardStatus,
      wizardAnswers: Array.isArray(wizardProfile?.answers)
        ? (wizardProfile?.answers as WizardAnswer[])
        : [],
    });

    return {
      assessment_id: assessmentId,
      wizard_status: wizardStatus,
      readiness_mode: null,
      classification_locked: evaluation.classification_locked,
      lock_reason: evaluation.lock_reason,
      missing_evidence: evaluation.missing_evidence,
      unresolved_unknown_items: evaluation.unresolved_unknown_items,
      completed_steps: evaluation.completed_steps,
      next_action: evaluation.next_action,
      updated_at: new Date().toISOString(),
      correlationId: query.correlationId,
    };
  }
}
