/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from "@nestjs/testing";
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { WIZARD_EVENT_TYPES, type WizardAnswer } from "@lcsp/contracts/wizard";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";

import { SubmitWizardHandler } from "./submit-wizard.handler.js";
import { SubmitWizardCommand } from "./submit-wizard.command.js";
import {
  WIZARD_PROFILE_REPOSITORY,
  type WizardProfileRepository,
} from "../../ports/persistence/wizard-profile.repository.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { WizardValidatorService } from "../../services/wizard/wizard-validator.service.js";
import { WizardProfileEntity } from "../../../domain/entities/wizard-profile.entity.js";
import { AssessmentNotFoundException } from "../../../domain/exceptions/wizard.exceptions.js";
import type { RepositorySnapshot } from "@prisma/client";

import { jest } from "@jest/globals";

type MockTransactionClient = {
  wizardProfile: { upsert: jest.Mock };
  assessment: { update: jest.Mock };
};

describe("SubmitWizardHandler", () => {
  let handler: SubmitWizardHandler;
  let wizardRepository: jest.Mocked<WizardProfileRepository>;
  let auditWriter: jest.Mocked<AuditWriterService>;
  let prismaService: jest.Mocked<PrismaService>;
  let outboxRepository: jest.Mocked<OutboxRepository>;
  let wizardValidator: WizardValidatorService;

  beforeEach(async () => {
    wizardRepository = {
      verifyAssessmentOwnership:
        jest.fn<WizardProfileRepository["verifyAssessmentOwnership"]>(),
      findByAssessmentId:
        jest.fn<WizardProfileRepository["findByAssessmentId"]>(),
      upsertDraft: jest.fn<WizardProfileRepository["upsertDraft"]>(),
    };

    auditWriter = {
      write: jest.fn<AuditWriterService["write"]>(),
      writeInTx: jest.fn<AuditWriterService["writeInTx"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;

    const mockTx: MockTransactionClient = {
      wizardProfile: { upsert: jest.fn() },
      assessment: { update: jest.fn() },
    };

    const mockTransaction = jest.fn(
      async (callback: (tx: MockTransactionClient) => Promise<void>) => {
        await callback(mockTx);
      },
    );

    prismaService = {
      $transaction: mockTransaction,
      repositorySnapshot: {
        findFirst: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    outboxRepository = {
      enqueue: jest.fn<OutboxRepository["enqueue"]>(),
    } as unknown as jest.Mocked<OutboxRepository>;

    wizardValidator = new WizardValidatorService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmitWizardHandler,
        { provide: WIZARD_PROFILE_REPOSITORY, useValue: wizardRepository },
        { provide: AuditWriterService, useValue: auditWriter },
        { provide: PrismaService, useValue: prismaService },
        { provide: OutboxRepository, useValue: outboxRepository },
        { provide: WizardValidatorService, useValue: wizardValidator },
      ],
    }).compile();

    handler = module.get<SubmitWizardHandler>(SubmitWizardHandler);
  });

  const validAnswers = [
    {
      questionId: "businessProcess",
      value: "Process",
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "aiPurpose",
      value: "Purpose",
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "dataTypes",
      value: ["Type"],
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "affectedSubjects",
      value: ["Group"],
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "decisionRole",
      value: "Role",
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "humanReview",
      value: "Oversight",
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "externalLlmUsage",
      value: "no",
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
  ] as WizardAnswer[];

  const command = new SubmitWizardCommand(
    "assessment-123",
    "org-1",
    "owner-1",
    validAnswers,
    "corr-id-1",
    {
      subjectRole: SUBJECT_ROLES.manager,
      selectedAction: PBAC_ACTIONS.wizardSubmit,
      policyId: "policy-manager",
      policyVersion: "v1",
    },
  );

  it("T01: All critical fields present -> 200, status = SUBMITTED, outbox enqueued", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(true);
    wizardRepository.findByAssessmentId.mockResolvedValue(null);

    const result = await handler.execute(command);

    expect(prismaService.$transaction).toHaveBeenCalled();
    expect(auditWriter.writeInTx).toHaveBeenCalled();
    expect(outboxRepository.enqueue).toHaveBeenCalled();

    expect(result.status).toBe(WIZARD_STATUS_CODES.submitted);
    expect(result.assessment_status).toBe(
      ASSESSMENT_STATUS_CODES.wizardSubmitted,
    );
    expect(result.version).toBe(1);
    expect(result.correlation_id).toBe("corr-id-1");
  });

  it("T02: Missing businessProcess -> 422 WIZARD_VALIDATION_FAILED", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(true);
    wizardRepository.findByAssessmentId.mockResolvedValue(null);

    const invalidCommand = new SubmitWizardCommand(
      command.assessmentId,
      command.organizationId,
      command.ownerId,
      [
        ...validAnswers.filter((a) => a.questionId !== "businessProcess"),
        {
          questionId: "businessProcess",
          value: "",
          answerState: "ANSWERED",
          updatedAt: "2026-07-31T00:00:00.000Z",
        },
      ],
      command.correlationId,
      command.authorization,
    );

    await expect(handler.execute(invalidCommand)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it("T03: Missing humanReview -> 422 WIZARD_VALIDATION_FAILED", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(true);
    wizardRepository.findByAssessmentId.mockResolvedValue(null);

    const invalidCommand = new SubmitWizardCommand(
      command.assessmentId,
      command.organizationId,
      command.ownerId,
      [
        ...validAnswers.filter((a) => a.questionId !== "humanReview"),
        {
          questionId: "humanReview",
          value: "",
          answerState: "ANSWERED",
          updatedAt: "2026-07-31T00:00:00.000Z",
        },
      ],
      command.correlationId,
      command.authorization,
    );

    await expect(handler.execute(invalidCommand)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it("T04: Already submitted -> 409 WIZARD_ALREADY_SUBMITTED", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(true);
    wizardRepository.findByAssessmentId.mockResolvedValue(
      WizardProfileEntity.rehydrate({
        id: "wizard-id-1",
        assessmentId: "assessment-123",
        status: WIZARD_STATUS_CODES.submitted,
      }),
    );
    prismaService.repositorySnapshot.findFirst.mockResolvedValue({
      id: "snapshot-1",
    } as unknown as RepositorySnapshot);

    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
  });

  it("T05: Assessment not found -> 404 ASSESSMENT_NOT_FOUND", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(false);

    await expect(handler.execute(command)).rejects.toThrow(
      AssessmentNotFoundException,
    );
  });

  it("T06: Assessment state transitions on submit", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(true);
    wizardRepository.findByAssessmentId.mockResolvedValue(null);
    let assessmentUpdateArg: { data: { status: string } } | undefined;
    const mockTx: MockTransactionClient = {
      wizardProfile: { upsert: jest.fn() },
      assessment: {
        update: jest
          .fn()
          .mockImplementation((arg: { data: { status: string } }) => {
            assessmentUpdateArg = arg;
          }),
      },
    };

    (prismaService.$transaction as jest.Mock).mockImplementation(
      async (callback: (tx: MockTransactionClient) => Promise<void>) => {
        await callback(mockTx);
      },
    );

    await handler.execute(command);
    expect(assessmentUpdateArg?.data.status).toBe(
      ASSESSMENT_STATUS_CODES.wizardSubmitted,
    );
  });

  it("T07: Outbox message created", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(true);
    wizardRepository.findByAssessmentId.mockResolvedValue(null);

    await handler.execute(command);

    const outboxArg = outboxRepository.enqueue.mock.calls[0][0];
    expect(outboxArg.eventType).toBe(WIZARD_EVENT_TYPES.submittedOutbox);
  });

  it("T10: Audit payload has no answers content", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(true);
    wizardRepository.findByAssessmentId.mockResolvedValue(null);

    await handler.execute(command);

    const auditArg = auditWriter.writeInTx.mock.calls[0][0];
    expect(auditArg.payload?.answers).toBeUndefined();
    expect(auditArg.payload).toEqual({
      assessmentId: "assessment-123",
      wizardProfileId: expect.any(String),
      version: 1,
      correlationId: "corr-id-1",
    });
  });

  it("denies access if not manager or wrong PBAC action", async () => {
    await expect(
      handler.execute(
        new SubmitWizardCommand(
          command.assessmentId,
          command.organizationId,
          command.ownerId,
          command.answers,
          command.correlationId,
          {
            ...command.authorization,
            subjectRole: SUBJECT_ROLES.developer,
          },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(auditWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({ decision: AUDIT_DECISIONS.deny }),
    );
  });
});
