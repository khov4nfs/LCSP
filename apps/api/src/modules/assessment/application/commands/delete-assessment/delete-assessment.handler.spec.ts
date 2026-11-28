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
  let lockedOwnerId = ownerId;
  let transactionNumber = 0;
  let completeConcurrentDeleteBeforeFirstLock = false;
  let changeOwnerBeforeFinalLock = false;
  let deletionFence: {
    ownerId: string;
    token: string;
    leaseExpiresAt: Date;
  } | null = null;
  let inTransaction = false;
  let externalCleanupInsideTransaction = false;
  let renewFenceDuringReclaim = false;
  let expiredLeaseReleases = 0;
  const lockQueries: unknown[] = [];
  const findById = jest.fn(() =>
    Promise.resolve(exists ? { id: assessmentId, ownerId } : null),
  );
  const findByIdForOwner = jest.fn<AssessmentRepository["findByIdForOwner"]>(
    () =>
      Promise.resolve(exists ? ({ id: assessmentId, ownerId } as never) : null),
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
    if (inTransaction) externalCleanupInsideTransaction = true;
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
  const findDeletionFence = jest.fn(() => Promise.resolve(deletionFence));
  const createDeletionFence = jest.fn(
    (input: {
      data: {
        assessmentId: string;
        ownerId: string;
        token: string;
        leaseExpiresAt: Date;
      };
      select: {
        ownerId: boolean;
        token: boolean;
        leaseExpiresAt: boolean;
      };
    }) => {
      deletionFence = {
        ownerId: input.data.ownerId,
        token: input.data.token,
        leaseExpiresAt: input.data.leaseExpiresAt,
      };
      return Promise.resolve(deletionFence);
    },
  );
  const claimDeletionFence = jest.fn(
    (input: {
      where: { assessmentId: string };
      data: { token: string; leaseExpiresAt: Date };
      select: {
        ownerId: boolean;
        token: boolean;
        leaseExpiresAt: boolean;
      };
    }) => {
      if (!deletionFence) throw new Error("missing deletion fence");
      deletionFence = {
        ...deletionFence,
        token: input.data.token,
        leaseExpiresAt: input.data.leaseExpiresAt,
      };
      return Promise.resolve(deletionFence);
    },
  );
  const claimDeletionFenceCas = jest.fn(
    (input: {
      where: {
        assessmentId: string;
        ownerId: string;
        token: string;
        leaseExpiresAt: { lte: Date };
      };
      data: { token: string; leaseExpiresAt: Date };
    }) => {
      if (!deletionFence) return Promise.resolve({ count: 0 });
      if (renewFenceDuringReclaim) {
        deletionFence = {
          ...deletionFence,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        };
      }
      if (
        deletionFence.ownerId !== input.where.ownerId ||
        deletionFence.token !== input.where.token ||
        deletionFence.leaseExpiresAt > input.where.leaseExpiresAt.lte
      ) {
        return Promise.resolve({ count: 0 });
      }
      deletionFence = {
        ...deletionFence,
        token: input.data.token,
        leaseExpiresAt: input.data.leaseExpiresAt,
      };
      return Promise.resolve({ count: 1 });
    },
  );
  const expireDeletionFence = jest.fn(
    (input: {
      where: { assessmentId: string; ownerId: string; token: string };
      data: { leaseExpiresAt: Date };
    }) => {
      if (
        deletionFence &&
        deletionFence.ownerId === input.where.ownerId &&
        deletionFence.token === input.where.token
      ) {
        if (input.data.leaseExpiresAt.getTime() <= Date.now()) {
          expiredLeaseReleases += 1;
        }
        deletionFence = {
          ...deletionFence,
          leaseExpiresAt: input.data.leaseExpiresAt,
        };
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    },
  );
  const tx = {
    $queryRaw: (query: unknown) => {
      lockQueries.push(query);
      return Promise.resolve(
        exists && lockedOwnerId === ownerId ? [{ id: assessmentId }] : [],
      );
    },
    assessment: {
      findUniqueOrThrow: () =>
        Promise.resolve({
          id: assessmentId,
          ownerId: lockedOwnerId,
          lifecycleState: Lifecycle.ACTIVE,
          lifecycleRevision: 4,
          runtime: { threadId, executionState: Execution.RUNNING },
        }),
      delete: remove,
    },
    assessmentRuntime: { update: revoke },
    assessmentHumanRequest: { updateMany: cancelRequests },
    assessmentArtifact: { findMany: artifacts },
    assessmentDeletionFence: {
      create: createDeletionFence,
      findUnique: findDeletionFence,
      update: claimDeletionFence,
      updateMany: claimDeletionFenceCas,
    },
    assessmentExecutionIsolation: {
      deleteMany: jest.fn(() => Promise.resolve()),
    },
    auditEvent: { findFirst: receipt, updateMany: sanitize },
    outboxMessage: { deleteMany: outbox },
    repositoryConnection: {
      findMany: connections,
      deleteMany: removeConnections,
    },
  };
  const prisma = {
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) => {
      transactionNumber += 1;
      if (transactionNumber === 1 && completeConcurrentDeleteBeforeFirstLock) {
        exists = false;
        receipt.mockResolvedValue({ id: randomUUID() });
      }
      inTransaction = true;
      try {
        return await work(tx);
      } finally {
        inTransaction = false;
        // The composite owner FK of a persisted deletion fence rejects owner
        // transfer; without the fence this simulates the race after revocation.
        if (
          transactionNumber === 1 &&
          changeOwnerBeforeFinalLock &&
          !deletionFence
        ) {
          lockedOwnerId = randomUUID();
        }
      }
    },
    auditEvent: { findFirst: receipt },
    assessmentArtifact: { findMany: artifacts },
    assessmentDeletionFence: { updateMany: expireDeletionFence },
  };
  const handler = new DeleteAssessmentHandler(
    { findById, findByIdForOwner } as unknown as AssessmentRepository,
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
    lockedOwnerId = ownerId;
    transactionNumber = 0;
    completeConcurrentDeleteBeforeFirstLock = false;
    changeOwnerBeforeFinalLock = false;
    deletionFence = null;
    inTransaction = false;
    externalCleanupInsideTransaction = false;
    renewFenceDuringReclaim = false;
    expiredLeaseReleases = 0;
    lockQueries.length = 0;
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
    expect(erase).toHaveBeenCalledWith(
      expect.objectContaining({ assessmentId, ownerId, threadId }),
    );
    expect(sanitize).toHaveBeenCalledWith(
      expect.objectContaining({ data: { payload: {} } }),
    );
    expect(findByIdForOwner).toHaveBeenCalledWith(assessmentId, ownerId);
    expect(findById).not.toHaveBeenCalled();
    expect(lockQueries).toHaveLength(2);
    for (const query of lockQueries) {
      const sql = query as { strings: readonly string[]; values: unknown[] };
      expect(sql.strings.join("?")).toContain('WHERE id=? AND "ownerId"=?');
      expect(sql.values).toEqual([assessmentId, ownerId]);
    }
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

  it("[RED][ASM-OWNER-01] revalidates ownership on the locked row before deletion side effects", async () => {
    // Simulate ownership changing after the preliminary repository read but
    // before the transaction acquires its authoritative row lock.
    lockedOwnerId = randomUUID();

    await expect(handler.execute(command())).rejects.toThrow();

    expect(lifecycle).not.toHaveBeenCalled();
    expect(erase).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(exists).toBe(true);
  });

  it("persists an owner-bound fence and runs external cleanup outside the transaction", async () => {
    changeOwnerBeforeFinalLock = true;

    await expect(handler.execute(command())).resolves.toEqual({
      assessment_id: assessmentId,
      deleted: true,
    });

    expect(createDeletionFence).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assessmentId,
        ownerId,
        token: expect.any(String),
      }),
      select: { ownerId: true, token: true, leaseExpiresAt: true },
    });
    expect(externalCleanupInsideTransaction).toBe(false);
    expect(remove).toHaveBeenCalled();
  });

  it("rejects a second cleanup claimant while the deletion lease is active", async () => {
    deletionFence = {
      ownerId,
      token: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    };

    await expect(handler.execute(command())).rejects.toMatchObject({
      status: 409,
    });

    expect(erase).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("reclaims an expired deletion lease before retrying cleanup", async () => {
    deletionFence = {
      ownerId,
      token: randomUUID(),
      leaseExpiresAt: new Date(0),
    };

    await expect(handler.execute(command())).resolves.toEqual({
      assessment_id: assessmentId,
      deleted: true,
    });

    expect(claimDeletionFenceCas).toHaveBeenCalledWith({
      where: {
        assessmentId,
        ownerId,
        token: expect.any(String),
        leaseExpiresAt: { lte: expect.any(Date) },
      },
      data: {
        token: expect.any(String),
        leaseExpiresAt: expect.any(Date),
      },
    });
  });

  it("loses reclamation when the prior claimant renews the observed token first", async () => {
    deletionFence = {
      ownerId,
      token: randomUUID(),
      leaseExpiresAt: new Date(0),
    };
    renewFenceDuringReclaim = true;

    await expect(handler.execute(command())).rejects.toMatchObject({
      status: 409,
    });

    expect(erase).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("replays a concurrent completed deletion when the first row lock misses", async () => {
    completeConcurrentDeleteBeforeFirstLock = true;

    await expect(handler.execute(command())).resolves.toEqual({
      assessment_id: assessmentId,
      deleted: true,
    });

    expect(erase).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
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
    expect(expireDeletionFence).toHaveBeenCalledWith({
      where: { assessmentId, ownerId, token: expect.any(String) },
      data: { leaseExpiresAt: expect.any(Date) },
    });
    expect(expiredLeaseReleases).toBe(1);
  });

  it("releases the matching lease when final database deletion fails", async () => {
    audit.mockRejectedValueOnce(new Error("finalization unavailable"));

    await expect(handler.execute(command())).rejects.toThrow(
      "finalization unavailable",
    );

    expect(remove).not.toHaveBeenCalled();
    expect(expiredLeaseReleases).toBe(1);
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

  it("reproducer: detaches and deletes assessmentExecutionIsolation before deleting assessment to avoid onDelete: Restrict constraint violation", async () => {
    const deleteIsolation = jest.fn<(...args: unknown[]) => Promise<unknown>>(
      () => Promise.resolve(),
    );
    (tx as Record<string, unknown>).assessmentExecutionIsolation = {
      deleteMany: deleteIsolation,
    };

    await handler.execute(command());

    expect(deleteIsolation).toHaveBeenCalledWith({
      where: { assessmentId },
    });
  });
});
