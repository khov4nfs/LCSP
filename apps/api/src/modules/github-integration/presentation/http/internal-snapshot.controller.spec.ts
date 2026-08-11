import { Readable, Writable } from "node:stream";

import { describe, expect, it, jest } from "@jest/globals";
import type { QueryBus } from "@nestjs/cqrs";
import type { Response } from "express";

import { InternalSnapshotController } from "./internal-snapshot.controller.js";

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
      execute: jest.fn().mockResolvedValue({
        snapshotId: "snapshot-1",
        commitSha: "a".repeat(40),
        repositoryFullName: "acme/example-repo",
        contentType: "application/gzip",
        resolvedUrl: "https://codeload.github.com/acme/example-repo/tar.gz/a",
        stream: Readable.from([Buffer.from("archive")]),
      }),
    } as unknown as QueryBus;
    const controller = new InternalSnapshotController(queryBus);

    await controller.streamArchive(
      "snapshot-1",
      "scan-job-1",
      { headers: { "x-correlation-id": "corr-1" } },
      response,
    );

    expect(Buffer.concat(body).toString()).toBe("archive");
    expect(responseStatus).toHaveBeenCalledWith(200);
  });
});
