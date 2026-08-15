import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";

import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import type { InternalSnapshotRequest } from "./dto/internal-snapshot.request.js";
import { type SnapshotArchiveStreamResult } from "../../application/queries/stream-snapshot-archive/stream-snapshot-archive.handler.js";
import { StreamSnapshotArchiveQuery } from "../../application/queries/stream-snapshot-archive/stream-snapshot-archive.query.js";

/**
 * Exposes worker-authenticated streaming of immutable repository snapshot archives for active scan jobs.
 */
@Controller("internal/repository-snapshots")
@UseGuards(WorkerApiKeyGuard)
export class InternalSnapshotController {
  /**
   * Creates the internal snapshot controller with the archive query dispatcher.
   *
   * @param queryBus - CQRS query bus used to validate and open pinned repository archive streams.
   */
  constructor(private readonly queryBus: QueryBus) {}

  /**
   * Streams the exact pinned repository archive authorized for a scan job without caching it in the API response path.
   *
   * @param snapshotId - Immutable repository snapshot identifier.
   * @param scanJobId - Scan job that must be bound to the snapshot.
   * @param request - Worker-authenticated request used to read the optional correlation header.
   * @param response - Express response that receives archive metadata headers and streamed content.
   * @returns A promise that resolves after the archive stream has been piped to the client.
   */
  @Get(":snapshotId/archive")
  async streamArchive(
    @Param("snapshotId") snapshotId: string,
    @Query("scanJobId") scanJobId: string,
    @Req() request: InternalSnapshotRequest,
    @Res() response: Response,
  ): Promise<void> {
    const correlationId = readHeader(request.headers["x-correlation-id"]);
    const result = await this.queryBus.execute<
      StreamSnapshotArchiveQuery,
      SnapshotArchiveStreamResult
    >(new StreamSnapshotArchiveQuery(snapshotId, scanJobId, correlationId));

    response.status(200);
    response.setHeader(
      "content-type",
      result.contentType ?? "application/gzip",
    );
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-snapshot-id", result.snapshotId);
    response.setHeader("x-commit-sha", result.commitSha);
    response.setHeader("x-repository-full-name", result.repositoryFullName);
    response.setHeader("x-resolved-url", result.resolvedUrl);
    await pipeline(result.stream, response);
  }
}

/**
 * Normalizes a single-or-array HTTP header value to one correlation string.
 *
 * @param value - Raw request header value.
 * @returns Trimmed first header value, or an empty string when absent.
 */
function readHeader(value: string | string[] | undefined): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return "";
}
