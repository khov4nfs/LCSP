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
   * Business rules:
   * - Worker authentication and query-handler authorization are required; a trusted hydration ticket ID accompanies only its pinned bytes.
   * Execution flow:
   * 1. Dispatch the snapshot/scan association query and set no-store, pin, archive, and optional hydration ticket headers.
   * 2. Pipeline archive bytes and retry transient completion finalization once; the worker can ACK the same ticket after validating the response.
   * Failure cases:
   * - Query, stream, or delivery failures reject through the shared API error path; a failed post-stream finalization leaves the ticket for worker ACK or reconciliation.
   * Side effects:
   * - Streams repository source to the worker and records hydration ticket completion; binary responses are not JSON-wrapped.
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
      if (result.hydrationDeliveryTicketId) {
        // Why: Worker acknowledgement can repair a failed server finalization
        // after response bytes have already been delivered.
        response.setHeader(
          "x-hydration-ticket-id",
          result.hydrationDeliveryTicketId,
        );
      }
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
        response.setHeader("x-repository-tree-id", result.treeManifest.treeId);
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
        // Why: The bytes are already delivered, so a transient persistence
        // failure deserves one idempotent retry before deferred reconciliation.
        try {
          await this.commandBus.execute(
            new FinalizeRuntimeHydrationTicketCommand(
              result.hydrationDeliveryTicketId,
              snapshotId,
              REPOSITORY_SCAN_JOB_STATUSES.completed,
            ),
          );
          return;
        } catch {
          // The durable ticket remains RUNNING for the explicit reconcile path.
        }
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

  /**
   * Business purpose: Confirm that a worker received and validated a trusted hydration archive.
   * Business rules:
   * - The worker key guard protects this route; the lifecycle checks exact trusted ticket and snapshot identity.
   * - Repeated acknowledgements are idempotent only for the same completed outcome.
   * Execution flow:
   * 1. Accept the worker's snapshot and ticket identifiers after archive validation.
   * 2. Commit the completed ticket outcome through the existing lifecycle command.
   * Failure cases:
   * - Missing, mismatched, or conflicting ticket state rejects without changing another scan job.
   * Side effects:
   * - May mark one trusted hydration ticket COMPLETED in the database.
   */
  @Post(":snapshotId/archive/ack/:scanJobId")
  acknowledgeHydrationTicket(
    @Param("snapshotId") snapshotId: string,
    @Param("scanJobId") scanJobId: string,
  ) {
    // Why: Reuse the finalizer's CAS and identity checks; an ACK must never
    // write a ticket by raw ID without the pinned snapshot boundary.
    return this.commandBus.execute(
      new FinalizeRuntimeHydrationTicketCommand(
        scanJobId,
        snapshotId,
        REPOSITORY_SCAN_JOB_STATUSES.completed,
      ),
    );
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
