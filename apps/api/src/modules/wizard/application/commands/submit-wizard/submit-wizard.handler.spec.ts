/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import {
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { WIZARD_EVENT_TYPES, type WizardAnswer } from "@lcsp/contracts/wizard";
import {
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { RepositorySnapshot } from "@prisma/client";
import { jest } from "@jest/globals";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { WizardProfileEntity } from "../../../domain/entities/wizard-profile.entity.js";
import { AssessmentNotFoundException } from "../../../domain/exceptions/wizard.exceptions.js";
import {
  WIZARD_PROFILE_REPOSITORY,
  type WizardProfileRepository,
} from "../../ports/persistence/wizard-profile.repository.js";
import { WizardValidatorService } from "../../services/wizard/wizard-validator.service.js";
import { SubmitWizardCommand } from "./submit-wizard.command.js";
import { SubmitWizardHandler } from "./submit-wizard.handler.js";

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
    prismaService = {
      $transaction: jest.fn(
        async (callback: (tx: MockTransactionClient) => Promise<void>) => {
          await callback(mockTx);
        },
      ),
      repositorySnapshot: { findFirst: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;

    outboxRepository = {
      enqueue: jest.fn<OutboxRepository["enqueue"]>(),
    } as unknown as jest.Mocked<OutboxRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmitWizardHandler,
        { provide: WIZARD_PROFILE_REPOSITORY, useValue: wizardRepository },
        { provide: AuditWriterService, useValue: auditWriter },
        { provide: PrismaService, useValue: prismaService },
        { provide: OutboxRepository, useValue: outboxRepository },
        {
          provide: WizardValidatorService,
          useValue: new WizardValidatorService(),
        },
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
      questionId: "useCase",
      value: "Use case",
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "primaryActors",
      value: "Manager, user, AI service",
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "businessTrigger",
      value: "User request starts the flow",
      answerState: "ANSWERED",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      questionId: "expectedOutcome",
      value: "Human-approved output",
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
      questionId: "autonomyLevel",
      value: "HUMAN_APPROVAL_REQUIRED",
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
    "owner-1",
    validAnswers,
    "corr-id-1",
    { subjectRole: AUTH_USER_ROLES.customer },
  );

  it("submits a valid wizard, transitions assessment, audits and enqueues outbox", async () => {
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
    expect(result.correlationId).toBe("corr-id-1");
  });

  it("rejects invalid required answers", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(true);
    wizardRepository.findByAssessmentId.mockResolvedValue(null);

    const invalidCommand = new SubmitWizardCommand(
      command.assessmentId,
      command.ownerId,
      validAnswers.map((answer) =>
        answer.questionId === "businessProcess"
          ? { ...answer, value: "" }
          : answer,
      ),
      command.correlationId,
      command.authorization,
    );

    await expect(handler.execute(invalidCommand)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it("rejects a submitted wizard once a repository snapshot exists", async () => {
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

  it("fails closed when the assessment is not owned by the caller", async () => {
    wizardRepository.verifyAssessmentOwnership.mockResolvedValue(false);

    await expect(handler.execute(command)).rejects.toThrow(
      AssessmentNotFoundException,
    );
  });

  it("writes the submitted assessment state and keeps answers out of audit payload", async () => {
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
    expect(outboxRepository.enqueue.mock.calls[0][0].eventType).toBe(
      WIZARD_EVENT_TYPES.submittedOutbox,
    );
    const auditArg = auditWriter.writeInTx.mock.calls[0][0];
    expect(auditArg.payload?.answers).toBeUndefined();
    expect(auditArg.payload).toEqual({
      assessmentId: "assessment-123",
      wizardProfileId: expect.any(String),
      version: 1,
      correlationId: "corr-id-1",
    });
  });
});
