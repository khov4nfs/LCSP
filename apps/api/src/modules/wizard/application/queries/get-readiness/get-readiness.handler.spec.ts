import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException } from "@nestjs/common";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_LOCK_REASONS,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { GetReadinessHandler } from "./get-readiness.handler.js";
import { GetReadinessQuery } from "./get-readiness.query.js";
import { AssessmentNotFoundException } from "../../../domain/exceptions/wizard.exceptions.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { ReadinessEvaluatorService } from "../../services/wizard/readiness-evaluator.service.js";
import type {
  Assessment,
  RepositorySnapshot,
  WizardProfile,
} from "@prisma/client";
import { WizardProfileStatus as PrismaWizardProfileStatus } from "@prisma/client";
import { jest } from "@jest/globals";

describe("GetReadinessHandler", () => {
  let handler: GetReadinessHandler;
  let prismaService: jest.Mocked<PrismaService>;
  let auditWriter: jest.Mocked<AuditWriterService>;
  let evaluatorService: jest.Mocked<ReadinessEvaluatorService>;

  beforeEach(async () => {
    prismaService = {
      assessment: { findFirst: jest.fn() },
      wizardProfile: { findUnique: jest.fn() },
      repositorySnapshot: { findFirst: jest.fn() },
      technicalEvidenceReport: { findFirst: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;

    auditWriter = {
      write: jest.fn(),
    } as unknown as jest.Mocked<AuditWriterService>;

    evaluatorService = {
      evaluate: jest.fn().mockReturnValue({
        classification_locked: true,
        lock_reason: ASSESSMENT_LOCK_REASONS.evidenceRequired,
        missing_evidence: [],
        completed_steps: [],
        next_action: "Some next action",
      }),
    } as unknown as jest.Mocked<ReadinessEvaluatorService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetReadinessHandler,
        { provide: PrismaService, useValue: prismaService },
        { provide: AuditWriterService, useValue: auditWriter },
        { provide: ReadinessEvaluatorService, useValue: evaluatorService },
      ],
    }).compile();

    handler = module.get<GetReadinessHandler>(GetReadinessHandler);
  });

  const query = new GetReadinessQuery(
    "assessment-123",
    "org-1",
    "user-1",
    "corr-1",
    {
      subjectRole: SUBJECT_ROLES.manager,
      selectedAction: PBAC_ACTIONS.assessmentRead,
      policyId: "pol-1",
      policyVersion: "v1",
    },
  );

  it("T07: Assessment not in org -> 404 ASSESSMENT_NOT_FOUND", async () => {
    prismaService.assessment.findFirst.mockResolvedValue(null);

    await expect(handler.execute(query)).rejects.toThrow(
      AssessmentNotFoundException,
    );
  });

  it("denies access and writes audit if not authorized", async () => {
    const invalidQuery = new GetReadinessQuery(
      query.assessmentId,
      query.organizationId,
      query.userId,
      query.correlationId,
      {
        ...query.authorization,
        subjectRole: SUBJECT_ROLES.developer,
        selectedAction: "some:other:action", // wrong action
      },
    );

    await expect(handler.execute(invalidQuery)).rejects.toThrow(
      ForbiddenException,
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(auditWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: AUDIT_DECISIONS.deny,
        reasonCode: AUTH_ERROR_CODES.pbacDenied,
      }),
    );
  });

  it("Happy path: calls evaluator and returns readiness response", async () => {
    prismaService.assessment.findFirst.mockResolvedValue({
      id: "assessment-123",
    } as Assessment);
    prismaService.wizardProfile.findUnique.mockResolvedValue({
      status: PrismaWizardProfileStatus.SUBMITTED,
    } as WizardProfile);
    prismaService.repositorySnapshot.findFirst.mockResolvedValue({
      id: "snapshot-1",
    } as RepositorySnapshot);
    prismaService.technicalEvidenceReport.findFirst.mockResolvedValue(null);

    const result = await handler.execute(query);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(evaluatorService.evaluate).toHaveBeenCalledWith({
      hasRepositoryConnection: true,
      hasAcceptedTechnicalEvidence: false,
      wizardStatus: WIZARD_STATUS_CODES.submitted,
      wizardAnswers: [],
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prismaService.repositorySnapshot.findFirst).toHaveBeenCalledWith({
      where: { assessmentId: "assessment-123" },
    });

    expect(result.assessment_id).toBe("assessment-123");
    expect(result.wizard_status).toBe(WIZARD_STATUS_CODES.submitted);
    expect(result.classification_locked).toBe(true);
    expect(result.lock_reason).toBe(ASSESSMENT_LOCK_REASONS.evidenceRequired);
  });
});
