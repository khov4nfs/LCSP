import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import {
  ASSESSMENT_LIFECYCLE_STATES as Lifecycle,
  AGENT_EXECUTION_STATES as Execution,
  HUMAN_RESOLUTION_REQUEST_STATUSES as HumanRequest,
} from "@lcsp/contracts/assessment";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import type { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";
import type { AssessmentRepository } from "../../ports/persistence/assessment.repository.js";
import { DeleteAssessmentCommand } from "./delete-assessment.command.js";
import { DeleteAssessmentHandler } from "./delete-assessment.handler.js";

describe("zero-retention assessment deletion command", () => {
  const assessmentId = randomUUID(),
    ownerId = randomUUID(),
    threadId = randomUUID();
  const command = () =>
    new DeleteAssessmentCommand(assessmentId, ownerId, randomUUID());
  const phases: string[] = [];
  let exists = true;
  const findById = jest.fn(() =>
    Promise.resolve(exists ? { id: assessmentId, ownerId } : null),
  );
  const receipt = jest
    .fn<(input: unknown) => Promise<{ id: string } | null>>()
    .mockResolvedValue(null);
  const revoke = jest.fn<(input: unknown) => Promise<void>>(() => {
    phases.push("revoke");
    return Promise.resolve();
  });
  const cancelRequests = jest.fn<(input: unknown) => Promise<void>>(() => {
    phases.push("requests");
    return Promise.resolve();
  });
  const lifecycle = jest.fn(() => {
    phases.push("lifecycle");
    return Promise.resolve();
  });
  const erase = jest.fn<(input: unknown) => Promise<void>>(() => {
    phases.push("erase");
    return Promise.resolve();
  });
  const eraseArtifact = jest.fn(() => {
    phases.push("artifact");
    return Promise.resolve();
  });
  const release = jest.fn(() => {
    phases.push("release");
    return Promise.resolve(["reservation"]);
  });
  const detach = jest.fn(() => {
    phases.push("detach");
    return Promise.resolve();
  });
  const sanitize = jest.fn<(input: unknown) => Promise<void>>(() => {
    phases.push("sanitize");
    return Promise.resolve();
  });
  const audit = jest.fn(() => {
    phases.push("receipt");
    return Promise.resolve();
  });
  const remove = jest.fn(() => {
    phases.push("delete");
    exists = false;
    return Promise.resolve();
  });
  const outbox = jest.fn(() => {
    phases.push("outbox");
    return Promise.resolve();
  });
  const connections = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
  const removeConnections = jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const manifest = {
    artifact_id: randomUUID(),
    total_size: 0,
    hash: "0".repeat(64),
    chunks: ["0".repeat(64) + ".chunk"],
  };
  const artifacts = jest.fn(() =>
    Promise.resolve([{ storageRef: JSON.stringify(manifest) }]),
  );
  const tx = {
    $queryRaw: () => Promise.resolve(exists ? [{ id: assessmentId }] : []),
    assessment: {
      findUniqueOrThrow: () =>
        Promise.resolve({
          id: assessmentId,
          lifecycleState: Lifecycle.ACTIVE,
          lifecycleRevision: 4,
          runtime: { threadId, executionState: Execution.RUNNING },
        }),
      delete: remove,
    },
    assessmentRuntime: { update: revoke },
    assessmentHumanRequest: { updateMany: cancelRequests },
    auditEvent: { updateMany: sanitize },
    outboxMessage: { deleteMany: outbox },
    repositoryConnection: {
      findMany: connections,
      deleteMany: removeConnections,
    },
  };
  const prisma = {
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
    auditEvent: { findFirst: receipt },
    assessmentArtifact: { findMany: artifacts },
  };
  const handler = new DeleteAssessmentHandler(
    { findById } as unknown as AssessmentRepository,
    prisma as unknown as PrismaService,
    { writeInTx: audit } as unknown as AuditWriterService,
    { releaseActiveReservations: release, detachAssessment: detach },
    {
      transitionVerifiedInTx: lifecycle,
    } as unknown as AssessmentLifecycleCoordinator,
    { erase },
    {
      eraseImmutableArtifact: eraseArtifact,
    } as unknown as ArtifactStorageService,
  );

  beforeEach(() => {
    phases.length = 0;
    exists = true;
    jest.clearAllMocks();
    erase.mockImplementation(() => {
      phases.push("erase");
      return Promise.resolve();
    });
    receipt.mockResolvedValue(null);
  });

  it("revokes and cancels first, erases content, then retains sanitized accounting and deletes", async () => {
    await expect(handler.execute(command())).resolves.toEqual({
      assessment_id: assessmentId,
      deleted: true,
    });
    expect(phases).toEqual([
      "lifecycle",
      "revoke",
      "requests",
      "erase",
      "artifact",
      "release",
      "sanitize",
      "receipt",
      "detach",
      "delete",
      "outbox",
    ]);
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          leaseToken: null,
          leaseExpiresAt: null,
          executionState: Execution.CANCELLED,
        },
      }),
    );
    expect(cancelRequests).toHaveBeenCalledWith({
      where: { assessmentId, status: HumanRequest.OPEN },
      data: { status: HumanRequest.CANCELLED },
    });
    expect(erase).toHaveBeenCalledWith({ assessmentId, ownerId, threadId });
    expect(sanitize).toHaveBeenCalledWith(
      expect.objectContaining({ data: { payload: {} } }),
    );
  });

  it("cannot erase an assessment owned by a different tenant", async () => {
    await expect(
      handler.execute(
        new DeleteAssessmentCommand(assessmentId, randomUUID(), randomUUID()),
      ),
    ).rejects.toThrow();
    expect(phases).toEqual([]);
    expect(erase).not.toHaveBeenCalled();
  });

  it("keeps the committed revocation and does not delete when external cleanup fails", async () => {
    erase.mockRejectedValueOnce(new Error("cleanup unavailable"));
    await expect(handler.execute(command())).rejects.toThrow(
      "cleanup unavailable",
    );
    expect(phases).toEqual(["lifecycle", "revoke", "requests"]);
    expect(remove).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(exists).toBe(true);
  });

  it("replays only the same authorized actor's content-free deletion receipt", async () => {
    exists = false;
    receipt.mockResolvedValueOnce({ id: randomUUID() });
    await expect(handler.execute(command())).resolves.toEqual({
      assessment_id: assessmentId,
      deleted: true,
    });
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actorId: ownerId,
          resourceId: assessmentId,
        }),
      }),
    );
    expect(phases).toEqual([]);
    await expect(handler.execute(command())).rejects.toThrow();
  });
});
