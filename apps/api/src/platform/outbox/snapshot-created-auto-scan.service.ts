import { Injectable } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  GITHUB_INTEGRATION_EVENT_TYPES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";

import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { TriggerScanCommand } from "../../modules/github-integration/application/commands/trigger-scan/trigger-scan.command.js";

type SnapshotCreatedPayload = {
  snapshotId?: unknown;
  assessmentId?: unknown;
  organizationId?: unknown;
  correlationId?: unknown;
  actor?: unknown;
};

type SnapshotCreatedActor = {
  id?: unknown;
};

/**
 * Handles snapshot-created outbox events and automatically starts a trusted scan for submitted assessments.
 */
@Injectable()
export class SnapshotCreatedAutoScanService {
  /**
   * Creates the handler with command dispatch and assessment persistence dependencies.
   *
   * @param commandBus - CQRS command bus used to dispatch the scan trigger command.
   * @param prisma - Prisma service used to verify the current assessment status.
   */
  constructor(
    private readonly commandBus: CommandBus,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Processes snapshot-created messages and triggers a trusted scan only for wizard-submitted assessments.
   *
   * @param message - Outbox event type and structured payload to inspect.
   * @returns A promise that resolves after the event is ignored or its scan command is dispatched.
   * @throws When a snapshot-created payload is missing required identifiers.
   */
  async handle(message: {
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    if (message.eventType !== GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated) {
      return;
    }

    const payload = message.payload as SnapshotCreatedPayload;
    const snapshotId = readString(payload.snapshotId);
    const assessmentId = readString(payload.assessmentId);
    const organizationId = readString(payload.organizationId);
    const actorId = readActorId(payload.actor);
    const correlationId =
      readString(payload.correlationId) ?? `snapshot-auto:${snapshotId ?? "?"}`;

    if (!snapshotId || !assessmentId || !organizationId) {
      throw new Error(
        "snapshotCreated payload missing snapshotId, assessmentId, or organizationId",
      );
    }

    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { status: true },
    });
    if (
      !assessment ||
      assessment.status !== ASSESSMENT_STATUS_CODES.wizardSubmitted
    ) {
      return;
    }

    await this.commandBus.execute(
      new TriggerScanCommand(
        assessmentId,
        snapshotId,
        REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
        buildAutoScanIdempotencyKey(assessmentId, snapshotId),
        actorId,
        organizationId,
        null,
        undefined,
        correlationId,
      ),
    );
  }
}

/**
 * Builds the deterministic idempotency key used for automatic scan creation from a snapshot event.
 *
 * @param assessmentId - Assessment associated with the repository snapshot.
 * @param snapshotId - Repository snapshot that should be scanned.
 * @returns Stable idempotency key for the assessment/snapshot pair.
 */
export function buildAutoScanIdempotencyKey(
  assessmentId: string,
  snapshotId: string,
): string {
  return ["snapshot-auto", assessmentId, snapshotId].join(":");
}

/**
 * Reads a non-empty string from an unknown event payload value.
 *
 * @param value - Unknown value to validate.
 * @returns The non-empty string, or null when the value is invalid.
 */
function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Extracts a valid actor identifier from an unknown snapshot-created actor payload.
 *
 * @param value - Unknown actor payload to inspect.
 * @returns Actor identifier when present and valid; otherwise null.
 */
function readActorId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return readString((value as SnapshotCreatedActor).id);
}
