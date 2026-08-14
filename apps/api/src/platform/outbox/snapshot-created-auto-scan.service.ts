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

@Injectable()
export class SnapshotCreatedAutoScanService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly prisma: PrismaService,
  ) {}

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

export function buildAutoScanIdempotencyKey(
  assessmentId: string,
  snapshotId: string,
): string {
  return ["snapshot-auto", assessmentId, snapshotId].join(":");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readActorId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return readString((value as SnapshotCreatedActor).id);
}
