import { Readable, Writable } from "node:stream";

import { describe, expect, it, jest } from "@jest/globals";
import type { QueryBus } from "@nestjs/cqrs";
import type { CommandBus } from "@nestjs/cqrs";
import type { Response } from "express";

import { InternalSnapshotController } from "./internal-snapshot.controller.js";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { ReconcileRuntimeHydrationTicketCommand } from "../../application/commands/reconcile-runtime-hydration-ticket/reconcile-runtime-hydration-ticket.command.js";

describe("InternalSnapshotController", () => {
  it("waits until the archive stream is fully written to the worker response", async () => {
    const body: Buffer[] = [];
    const responseStatus = jest.fn().mockReturnThis();
    const response = Object.assign(
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          body.push(Buffer.from(chunk));
          callback();
        },
      }),
      {
        setHeader: jest.fn(),
        status: responseStatus,
      },
    ) as unknown as Response;
    const queryBus = {
      execute: jest
        .fn<
          () => Promise<{
            snapshotId: string;
            commitSha: string;
            repositoryFullName: string;
            contentType: string;
            resolvedUrl: string;
            stream: Readable;
            hydrationDeliveryTicketId?: string;
          }>
        >()
        .mockResolvedValue({
          snapshotId: "snapshot-1",
          commitSha: "a".repeat(40),
          repositoryFullName: "acme/example-repo",
          contentType: "application/gzip",
          resolvedUrl: "https://codeload.github.com/acme/example-repo/tar.gz/a",
          stream: Readable.from([Buffer.from("archive")]),
          hydrationDeliveryTicketId: "hydration-ticket-1",
        }),
    } as unknown as QueryBus;
    const commandExecute = jest
      .fn<(command: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const commandBus = { execute: commandExecute } as unknown as CommandBus;
    const controller = new InternalSnapshotController(queryBus, commandBus);

    await controller.streamArchive(
      "snapshot-1",
      "scan-job-1",
      { headers: { "x-correlation-id": "corr-1" } },
      response,
    );

    expect(Buffer.concat(body).toString()).toBe("archive");
    expect(responseStatus).toHaveBeenCalledWith(200);
    expect(commandExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "hydration-ticket-1",
        snapshotId: "snapshot-1",
        outcome: REPOSITORY_SCAN_JOB_STATUSES.completed,
      }),
    );
  });

  it("finalizes a hydration delivery as failed when response streaming errors", async () => {
    const response = Object.assign(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback(new Error("client disconnected"));
        },
      }),
      { setHeader: jest.fn(), status: jest.fn().mockReturnThis() },
    ) as unknown as Response;
    const queryBus = {
      execute: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({
          snapshotId: "snapshot-1",
          commitSha: "a".repeat(40),
          repositoryFullName: "acme/example-repo",
          contentType: "application/gzip",
          resolvedUrl: "https://codeload.github.com/",
          stream: Readable.from([Buffer.from("archive")]),
          hydrationDeliveryTicketId: "hydration-ticket-1",
        }),
    } as unknown as QueryBus;
    const commandExecute = jest
      .fn<(command: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const commandBus = { execute: commandExecute } as unknown as CommandBus;
    const controller = new InternalSnapshotController(queryBus, commandBus);

    await expect(
      controller.streamArchive(
        "snapshot-1",
        "hydration-ticket-1",
        { headers: {} },
        response,
      ),
    ).rejects.toThrow();
    expect(commandExecute).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: REPOSITORY_SCAN_JOB_STATUSES.failed }),
    );
  });

  it("dispatches historical reconciliation through the supported command path", async () => {
    const queryBus = { execute: jest.fn() } as unknown as QueryBus;
    const commandExecute = jest
      .fn<(command: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const controller = new InternalSnapshotController(queryBus, {
      execute: commandExecute,
    } as unknown as CommandBus);

    await controller.reconcileHydrationTicket("snapshot-1", "ticket-1");

    expect(commandExecute).toHaveBeenCalledTimes(1);
    expect(commandExecute.mock.calls[0]?.[0]).toBeInstanceOf(
      ReconcileRuntimeHydrationTicketCommand,
    );
    expect(commandExecute.mock.calls[0]?.[0]).toMatchObject({
      ticketId: "ticket-1",
      snapshotId: "snapshot-1",
    });
  });
});
