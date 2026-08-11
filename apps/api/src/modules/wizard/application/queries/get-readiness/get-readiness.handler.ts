import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { HttpStatus } from "@nestjs/common";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { WIZARD_STATUS_CODES } from "@lcsp/contracts/assessment";
import { WIZARD_EVENT_TYPES, type WizardAnswer } from "@lcsp/contracts/wizard";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { GetReadinessQuery } from "./get-readiness.query.js";
import type { ReadinessResponse } from "../../contracts/wizard/readiness.contract.js";
import { AssessmentNotFoundException } from "../../../domain/exceptions/wizard.exceptions.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { ReadinessEvaluatorService } from "../../services/wizard/readiness-evaluator.service.js";
import {
  fromPrismaWizardStatus,
  toPrismaEvidenceAcceptanceStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";

@QueryHandler(GetReadinessQuery)
export class GetReadinessHandler implements IQueryHandler<
  GetReadinessQuery,
  ReadinessResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly readinessEvaluator: ReadinessEvaluatorService,
  ) {}

  async execute(query: GetReadinessQuery): Promise<ReadinessResponse> {
    await this.assertReadAction(query);

    const { assessmentId, organizationId } = query;

    // Verify assessment exists and belongs to organization
    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        organizationId,
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
      correlation_id: query.correlationId,
    };
  }

  private async assertReadAction(query: GetReadinessQuery): Promise<void> {
    const { authorization } = query;
    const isManagerOrDev =
      authorization.subjectRole === SUBJECT_ROLES.manager ||
      authorization.subjectRole === SUBJECT_ROLES.developer;
    const hasReadAction =
      authorization.selectedAction === PBAC_ACTIONS.assessmentRead;
    const hasPolicy =
      authorization.policyId !== null && authorization.policyVersion !== null;

    if (isManagerOrDev && hasReadAction && hasPolicy) {
      return;
    }

    // Write audit log on denial
    await this.auditWriter.write({
      eventType: WIZARD_EVENT_TYPES.readinessRead,
      actorId: query.userId,
      organizationId: query.organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.assessmentRecord,
      resourceId: query.assessmentId,
      decision: AUDIT_DECISIONS.deny,
      reasonCode: AUTH_ERROR_CODES.pbacDenied,
      correlationId: query.correlationId,
      policyId: authorization.policyId,
      policyVersion: authorization.policyVersion,
      payload: {
        assessmentId: query.assessmentId,
        action: PBAC_ACTIONS.assessmentRead,
        result: AUDIT_DECISIONS.deny,
      },
    });

    throw problemException(AUTH_ERROR_CODES.pbacDenied, query.correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }
}
