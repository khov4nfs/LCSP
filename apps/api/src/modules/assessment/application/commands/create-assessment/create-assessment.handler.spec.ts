import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import { UnprocessableEntityException } from "@nestjs/common";

import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import type { AssessmentRepository } from "../../ports/persistence/assessment.repository.js";
import { CreateAssessmentCommand } from "./create-assessment.command.js";
import { CreateAssessmentHandler } from "./create-assessment.handler.js";

function buildHandler() {
  const save = jest
    .fn<AssessmentRepository["save"]>()
    .mockResolvedValue(undefined);
  const saveInTx = jest
    .fn<AssessmentRepository["saveInTx"]>()
    .mockResolvedValue(undefined);
  const findById = jest
    .fn<AssessmentRepository["findById"]>()
    .mockResolvedValue(null);
  const findMany = jest
    .fn<AssessmentRepository["findMany"]>()
    .mockResolvedValue({ items: [], total: 0 });
  const repository: AssessmentRepository = {
    save,
    saveInTx,
    findById,
    findMany,
  };

  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  const auditWriter = { write, writeInTx } as unknown as AuditWriterService;

  const enqueue = jest
    .fn<OutboxRepository["enqueue"]>()
    .mockResolvedValue("outbox-message-1");
  const outboxRepository = { enqueue } as unknown as OutboxRepository;
  const tx = { tx: "assessment-create" };
  const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
    Promise.resolve(callback(tx)),
  );
  const prisma = { $transaction: transaction };

  const handler = new CreateAssessmentHandler(
    repository,
    auditWriter,
    outboxRepository,
    prisma as never,
  );

  return {
    handler,
    saveInTx,
    writeInTx,
    enqueue,
    tx,
    transaction,
  };
}

describe("CreateAssessmentHandler", () => {
  it("creates an assessment with WIZARD_IN_PROGRESS status", async () => {
    const { handler, saveInTx } = buildHandler();

    const result = await handler.execute(
      new CreateAssessmentCommand(
        "user-1",
        "My AI System Assessment",
        undefined,
        "corr-1",
      ),
    );

    expect(result.status).toBe(ASSESSMENT_STATUS_CODES.wizardInProgress);
    expect(result.assessment_id).toBeTruthy();
    expect(result.correlationId).toBe("corr-1");
    expect(saveInTx).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing name", async () => {
    const { handler, saveInTx } = buildHandler();

    await expect(
      handler.execute(
        new CreateAssessmentCommand("user-1", undefined, undefined, "corr-1"),
      ),
    ).rejects.toThrow(UnprocessableEntityException);

    try {
      await handler.execute(
        new CreateAssessmentCommand("user-1", undefined, undefined, "corr-1"),
      );
    } catch (error) {
      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        ok: false,
        problem: {
          code: ASSESSMENT_ERROR_CODES.invalidRequest,
          correlationId: "corr-1",
        },
      });
    }
    expect(saveInTx).not.toHaveBeenCalled();
  });

  it("rejects an overlong name", async () => {
    const { handler, saveInTx } = buildHandler();

    await expect(
      handler.execute(
        new CreateAssessmentCommand(
          "user-1",
          "a".repeat(201),
          undefined,
          "corr-1",
        ),
      ),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(saveInTx).not.toHaveBeenCalled();
  });

  it("rejects an overlong description", async () => {
    const { handler, saveInTx } = buildHandler();

    await expect(
      handler.execute(
        new CreateAssessmentCommand(
          "user-1",
          "Valid name",
          "a".repeat(1001),
          "corr-1",
        ),
      ),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(saveInTx).not.toHaveBeenCalled();
  });

  it("uses the authenticated owner id from the command", async () => {
    const { handler, saveInTx } = buildHandler();

    await handler.execute(
      new CreateAssessmentCommand("user-42", "Name", undefined, "corr-1"),
    );

    expect(saveInTx.mock.calls[0][0].ownerId).toBe("user-42");
  });

  it("writes an allow audit event without name or description", async () => {
    const { handler, writeInTx } = buildHandler();

    await handler.execute(
      new CreateAssessmentCommand(
        "user-1",
        "Secret Project Name",
        "Sensitive description",
        "corr-1",
      ),
    );

    const event = writeInTx.mock.calls[0][0];
    expect(event).toMatchObject({
      eventType: ASSESSMENT_EVENT_TYPES.created,
      actorId: "user-1",
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      correlationId: "corr-1",
      decision: AUDIT_DECISIONS.allow,
    });
    expect(JSON.stringify(event.payload)).not.toMatch(/Secret Project Name/);
    expect(JSON.stringify(event.payload)).not.toMatch(/Sensitive description/);
  });

  it("enqueues an assessment.created outbox message", async () => {
    const { handler, enqueue, tx } = buildHandler();

    await handler.execute(
      new CreateAssessmentCommand("user-1", "Name", undefined, "corr-1"),
    );

    const input = enqueue.mock.calls[0][0];
    expect(input.eventType).toBe(ASSESSMENT_EVENT_TYPES.createdOutbox);
    expect(input.aggregateType).toBe(OUTBOX_AGGREGATE_TYPES.assessment);
    expect(input.correlationId).toBe("corr-1");
    expect(input.causationId).toBe("corr-1");
    expect(input.assessmentId).toBeTruthy();
    expect(enqueue.mock.calls[0][1]).toBe(tx);
  });

  it("writes assessment, audit, and outbox through one transaction", async () => {
    const { handler, saveInTx, writeInTx, enqueue, tx, transaction } =
      buildHandler();

    await handler.execute(
      new CreateAssessmentCommand("user-1", "Name", undefined, "corr-1"),
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(saveInTx.mock.calls[0][1]).toBe(tx);
    expect(writeInTx.mock.calls[0][1]).toBe(tx);
    expect(enqueue.mock.calls[0][1]).toBe(tx);
  });
});
