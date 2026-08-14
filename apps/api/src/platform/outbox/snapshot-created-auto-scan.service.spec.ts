import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  GITHUB_INTEGRATION_EVENT_TYPES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import { jest } from "@jest/globals";
import type { CommandBus } from "@nestjs/cqrs";

import { SnapshotCreatedAutoScanService } from "./snapshot-created-auto-scan.service.js";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { TriggerScanCommand } from "../../modules/github-integration/application/commands/trigger-scan/trigger-scan.command.js";

function makeCommandBus() {
  return {
    execute: jest.fn<CommandBus["execute"]>().mockResolvedValue(undefined),
  } as unknown as CommandBus;
}

function makePrismaService(status: string | null) {
  return {
    assessment: {
      findUnique: jest
        .fn<() => Promise<{ status: string } | null>>()
        .mockResolvedValue(status === null ? null : { status }),
    },
  } as unknown as PrismaService;
}

describe("SnapshotCreatedAutoScanService", () => {
  it("dispatches a trusted scan trigger when the assessment is submitted", async () => {
    const commandBus = makeCommandBus();
    const prisma = makePrismaService(ASSESSMENT_STATUS_CODES.wizardSubmitted);
    const service = new SnapshotCreatedAutoScanService(commandBus, prisma);

    await service.handle({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
      payload: {
        snapshotId: "snapshot-1",
        assessmentId: "assessment-1",
        organizationId: "org-1",
        correlationId: "corr-1",
        actor: {
          id: "user-1",
        },
      },
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.any(TriggerScanCommand),
    );
    const command = (commandBus.execute as jest.Mock).mock
      .calls[0][0] as TriggerScanCommand;
    expect(command.triggerSource).toBe(REPOSITORY_SCAN_TRIGGER_SOURCES.trusted);
    expect(command.assessmentId).toBe("assessment-1");
    expect(command.snapshotId).toBe("snapshot-1");
    expect(command.idempotencyKey).toBe(
      "snapshot-auto:assessment-1:snapshot-1",
    );
    expect(command.actorId).toBe("user-1");
    expect(command.organizationId).toBe("org-1");
  });

  it("uses a fallback trusted correlationId when the payload omits one", async () => {
    const commandBus = makeCommandBus();
    const prisma = makePrismaService(ASSESSMENT_STATUS_CODES.wizardSubmitted);
    const service = new SnapshotCreatedAutoScanService(commandBus, prisma);

    await service.handle({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
      payload: {
        snapshotId: "snapshot-1",
        assessmentId: "assessment-1",
        organizationId: "org-1",
      },
    });

    const command = (commandBus.execute as jest.Mock).mock
      .calls[0][0] as TriggerScanCommand;
    expect(command.correlationId).toBe("snapshot-auto:snapshot-1");
  });

  it("skips auto-chain when the assessment is not submitted", async () => {
    const commandBus = makeCommandBus();
    const prisma = makePrismaService(ASSESSMENT_STATUS_CODES.wizardInProgress);
    const service = new SnapshotCreatedAutoScanService(commandBus, prisma);

    await service.handle({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
      payload: {
        snapshotId: "snapshot-1",
        assessmentId: "assessment-1",
        organizationId: "org-1",
      },
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(commandBus.execute).not.toHaveBeenCalled();
  });
});
