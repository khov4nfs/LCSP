import { describe, expect, it, jest } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import {
  AssessmentRevisionConflictError,
  AssessmentUpdateTargetNotFoundError,
} from "../../ports/persistence/assessment.repository.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import { RenameAssessmentCommand } from "./rename-assessment.command.js";
import { RenameAssessmentHandler } from "./rename-assessment.handler.js";

/**
 * Unit test suite asserting renaming business logic and audit compliance for RenameAssessmentHandler.
 */
describe("RenameAssessmentHandler", () => {
  const assessmentId = "11111111-1111-4111-8111-111111111111";
  const actorId = "user-123";
  const correlationId = "corr-rename-test";

  const createHandler = (assessment: Assessment | null) => {
    const assessments = {
      findById: jest
        .fn<(...args: unknown[]) => Promise<Assessment | null>>()
        .mockResolvedValue(assessment),
      findByIdForOwner: jest
        .fn<(...args: unknown[]) => Promise<Assessment | null>>()
        .mockResolvedValue(assessment),
      saveInTx: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const auditWriter = {
      writeInTx: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const tx = {};
    const prisma = {
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
    };

    const handler = new RenameAssessmentHandler(
      assessments as never,
      prisma as never,
      auditWriter as never,
    );

    return { handler, assessments, auditWriter, tx };
  };

  it("reproducer: records fromName and toName in audit event payload for non-repudiation", async () => {
    const assessment = Assessment.rehydrate({
      id: assessmentId,
      ownerId: actorId,
      name: "Old Assessment Name",
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { handler, assessments, auditWriter } = createHandler(assessment);
    const command = new RenameAssessmentCommand(
      assessmentId,
      actorId,
      "New Assessment Name",
      correlationId,
    );

    const result = await handler.execute(command);
    expect(result).toEqual({
      assessment_id: assessmentId,
      name: "New Assessment Name",
    });

    // The audit event payload MUST record fromName and toName, not merely { assessmentId }
    expect(auditWriter.writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          fromName: "Old Assessment Name",
          toName: "New Assessment Name",
        }),
      }),
      expect.anything(),
    );
    expect(assessments.findByIdForOwner).toHaveBeenCalledWith(
      assessmentId,
      actorId,
    );
    expect(assessments.findById).not.toHaveBeenCalled();
    expect(assessment.isNew).toBe(false);
    expect(assessment.expectedUpdatedAt).toEqual(assessment.updatedAt);
  });

  it("maps a stale revision to the request correlation id and rolls back audit", async () => {
    const assessment = Assessment.rehydrate({
      id: assessmentId,
      ownerId: actorId,
      name: "Old Assessment Name",
      description: null,
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
      updatedAt: new Date("2026-11-20T00:00:00.000Z"),
    });
    const { handler, assessments, auditWriter } = createHandler(assessment);
    assessments.saveInTx.mockRejectedValueOnce(
      new AssessmentRevisionConflictError(),
    );

    await expect(
      handler.execute(
        new RenameAssessmentCommand(
          assessmentId,
          actorId,
          "Concurrent name",
          correlationId,
        ),
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: {
        problem: expect.objectContaining({ correlationId }),
      },
    });
    expect(auditWriter.writeInTx).not.toHaveBeenCalled();
  });

  it("maps a disappeared owner-scoped update target to masked not-found", async () => {
    const assessment = Assessment.rehydrate({
      id: assessmentId,
      ownerId: actorId,
      name: "Old Assessment Name",
      description: null,
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
      updatedAt: new Date("2026-11-20T00:00:00.000Z"),
    });
    const { handler, assessments, auditWriter } = createHandler(assessment);
    assessments.saveInTx.mockRejectedValueOnce(
      new AssessmentUpdateTargetNotFoundError(),
    );

    await expect(
      handler.execute(
        new RenameAssessmentCommand(
          assessmentId,
          actorId,
          "Updated name",
          correlationId,
        ),
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: {
        problem: expect.objectContaining({ correlationId }),
      },
    });
    expect(auditWriter.writeInTx).not.toHaveBeenCalled();
  });
});
