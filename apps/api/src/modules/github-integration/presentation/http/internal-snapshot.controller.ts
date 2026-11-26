import {
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";

import { WorkerApiKeyGuard } from "../../../../platform/rbac/guards/worker-api-key.guard.js";
import type { InternalSnapshotRequest } from "./dto/internal-snapshot.request.js";
import { type SnapshotArchiveStreamResult } from "../../application/queries/stream-snapshot-archive/stream-snapshot-archive.handler.js";
import { StreamSnapshotArchiveQuery } from "../../application/queries/stream-snapshot-archive/stream-snapshot-archive.query.js";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { FinalizeRuntimeHydrationTicketCommand } from "../../application/commands/finalize-runtime-hydration-ticket/finalize-runtime-hydration-ticket.command.js";
import { ReconcileRuntimeHydrationTicketCommand } from "../../application/commands/reconcile-runtime-hydration-ticket/reconcile-runtime-hydration-ticket.command.js";

/**
 * Exposes worker-authenticated streaming of immutable repository snapshot archives for active scan jobs.
 */
@Controller("internal/repository-snapshots")
@UseGuards(WorkerApiKeyGuard)
export class InternalSnapshotController {
  private readonly logger = new Logger(InternalSnapshotController.name);
  /**
   * Creates the internal snapshot controller with archive query and lifecycle command dispatchers.
   *
   * @param queryBus - CQRS query bus used to validate and open pinned repository archive streams.
   * @param commandBus - CQRS command bus used to finalize/reconcile hydration tickets.
   */
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  /**
   * Business purpose: Deliver one authorized immutable repository archive to the worker hydration client.
   * Business rules: Worker authentication and query-handler authorization are required; format and optional exact wrapper metadata are returned with the same pinned bytes.
   * Execution flow: 1. Dispatch the snapshot/scan association query. 2. Set no-store and pin/archive metadata headers. 3. Pipeline archive bytes and finalize hydration delivery.
   * Failure cases: Query, stream, or delivery failures finalize the hydration ticket as failed and propagate through the shared API error path.
   * Side effects: Streams repository source to the worker and records hydration ticket completion; it does not wrap the binary response in JSON.
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

    try {
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
      response.setHeader(
        "x-repository-archive-root-status",
        result.archiveRootStatus,
      );
      if (typeof result.archiveRoot === "string") {
        response.setHeader("x-repository-archive-root", result.archiveRoot);
      }
      if (result.treeManifest) {
        response.setHeader(
          "x-repository-tree-manifest-version",
          String(result.treeManifest.version),
        );
        response.setHeader(
          "x-repository-tree-commit-sha",
          result.treeManifest.commitSha,
        );
        response.setHeader(
          "x-repository-tree-id",
          result.treeManifest.treeId,
        );
        response.setHeader(
          "x-repository-tree-file-count",
          String(result.treeManifest.fileCount),
        );
        response.setHeader(
          "x-repository-tree-path-sha256",
          result.treeManifest.pathSha256,
        );
      }
      await pipeline(result.stream, response);
    } catch (error: unknown) {
      if (result.hydrationDeliveryTicketId) {
        try {
          await this.commandBus.execute(
            new FinalizeRuntimeHydrationTicketCommand(
              result.hydrationDeliveryTicketId,
              snapshotId,
              REPOSITORY_SCAN_JOB_STATUSES.failed,
            ),
          );
        } catch (finalizationError: unknown) {
          this.logger.error(
            "Runtime hydration delivery failure could not be persisted",
            undefined,
            {
              scanJobId: result.hydrationDeliveryTicketId,
              reason:
                finalizationError instanceof Error
                  ? finalizationError.name
                  : "unknown",
            },
          );
        }
      }
      throw error;
    }
    if (result.hydrationDeliveryTicketId) {
      try {
        await this.commandBus.execute(
          new FinalizeRuntimeHydrationTicketCommand(
            result.hydrationDeliveryTicketId,
            snapshotId,
            REPOSITORY_SCAN_JOB_STATUSES.completed,
          ),
        );
      } catch (finalizationError: unknown) {
        this.logger.error(
          "Runtime hydration delivery success could not be persisted",
          undefined,
          {
            scanJobId: result.hydrationDeliveryTicketId,
            reason:
              finalizationError instanceof Error
                ? finalizationError.name
                : "unknown",
          },
        );
      }
    }
  }

  @Post(":snapshotId/archive/reconcile/:scanJobId")
  reconcileHydrationTicket(
    @Param("snapshotId") snapshotId: string,
    @Param("scanJobId") scanJobId: string,
  ) {
    return this.commandBus.execute(
      new ReconcileRuntimeHydrationTicketCommand(scanJobId, snapshotId),
    );
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
