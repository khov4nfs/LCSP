import { GITHUB_INTEGRATION_EVENT_TYPES } from "@lcsp/contracts/github-integration";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { RepositorySnapshot } from "../../domain/entities/repository-snapshot.entity.js";
import { PrismaRepositorySnapshotRepository } from "./prisma-repository-snapshot.repository.js";

describe("PrismaRepositorySnapshotRepository", () => {
  it("persists metadata and the created event in one transaction", async () => {
    const create = jest
      .fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>()
      .mockResolvedValue({});
    const tx = { repositorySnapshot: { create } };
    const transaction = jest
      .fn<(callback: (client: typeof tx) => Promise<void>) => Promise<void>>()
      .mockImplementation((callback) => callback(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const enqueue = jest
      .fn<OutboxRepository["enqueue"]>()
      .mockResolvedValue("outbox-message-1");
    const repository = new PrismaRepositorySnapshotRepository(prisma, {
      enqueue,
    } as unknown as OutboxRepository);
    const snapshot = RepositorySnapshot.create({
      assessmentId: "assessment-1",
      connectionId: "connection-1",
      repositoryId: "repo-1",
      repositoryFullName: "acme/example-repo",
      branch: "main",
      ref: null,
      commitSha: "a".repeat(40),
      providerMetadata: {
        authorDate: null,
        committerDate: null,
        htmlUrl: `https://github.com/acme/example-repo/commit/${"a".repeat(40)}`,
        requestedRevision: "main",
      },
      actorId: "manager-1",
    });
    const event = {
      aggregateType: OUTBOX_AGGREGATE_TYPES.repositorySnapshot,
      aggregateId: snapshot.id,
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
      payload: { snapshotId: snapshot.id },
    };

    await repository.saveWithCreatedEvent(snapshot, event);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ source: expect.anything() }),
    });
    expect(create.mock.calls[0][0]).toEqual({
      data: expect.objectContaining({
        id: snapshot.id,
        commitSha: "a".repeat(40),
        providerMetadata: snapshot.providerMetadata,
      }),
    });
    expect(enqueue.mock.calls[0]?.[0]).toEqual(event);
    expect(enqueue.mock.calls[0]?.[1]).toBe(tx);
  });
});
