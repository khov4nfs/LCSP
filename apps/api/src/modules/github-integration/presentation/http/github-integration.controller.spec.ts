import { describe, expect, it, jest } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import type { CommandBus } from "@nestjs/cqrs";

import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import {
  PBAC_ACTIONS,
  PBAC_METADATA_TYPES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";

import { PBAC_METADATA_KEY } from "../../../../platform/pbac/decorators/pbac-metadata.js";
import { PinSnapshotCommand } from "../../application/commands/pin-snapshot/pin-snapshot.command.js";
import { TriggerScanCommand } from "../../application/commands/trigger-scan/trigger-scan.command.js";
import type { TriggerScanDto } from "../../application/contracts/github-integration/trigger-scan.contract.js";
import { GitHubIntegrationController } from "./github-integration.controller.js";

describe("GitHubIntegrationController.pinSnapshot", () => {
  it("requires the snapshot:create PBAC action", () => {
    const metadata = Reflect.getMetadata(
      PBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      GitHubIntegrationController.prototype.pinSnapshot,
    ) as unknown;

    expect(metadata).toEqual({
      type: PBAC_METADATA_TYPES.action,
      action: PBAC_ACTIONS.snapshotCreate,
    });
  });

  it("dispatches an assessment and actor scoped PinSnapshotCommand", async () => {
    const execute = jest
      .fn<(command: unknown) => Promise<{ snapshot_id: string }>>()
      .mockResolvedValue({ snapshot_id: "snapshot-1" });
    const controller = new GitHubIntegrationController({
      execute,
    } as unknown as CommandBus);

    await controller.pinSnapshot(
      "assessment-1",
      {
        connection_id: "connection-1",
        branch: "main",
      },
      {
        correlationId: "corr-1",
        pbacContext: {
          organizationId: "org-1",
          userId: "manager-1",
          subjectRole: SUBJECT_ROLES.manager,
          scope: null,
        },
      } as never,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBeInstanceOf(PinSnapshotCommand);
    expect(execute.mock.calls[0][0]).toMatchObject({
      assessmentId: "assessment-1",
      organizationId: "org-1",
      actorId: "manager-1",
      connectionId: "connection-1",
      branch: "main",
      correlationId: "corr-1",
    });
  });
});

describe("GitHubIntegrationController.triggerScan", () => {
  it("requires the scan:trigger PBAC action", () => {
    const metadata = Reflect.getMetadata(
      PBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      GitHubIntegrationController.prototype.triggerScan,
    ) as unknown;

    expect(metadata).toEqual({
      type: PBAC_METADATA_TYPES.action,
      action: PBAC_ACTIONS.scanTrigger,
    });
  });

  it("dispatches the command and selects 201 for a new job", async () => {
    const execute = jest
      .fn<(command: unknown) => Promise<TriggerScanDto>>()
      .mockResolvedValue({
        scan_job_id: "scan-job-1",
        status: REPOSITORY_SCAN_JOB_STATUSES.queued,
        is_new: true,
        correlationId: "corr-1",
      });
    const status = jest.fn<(code: number) => unknown>();
    const controller = new GitHubIntegrationController({
      execute,
    } as unknown as CommandBus);

    await controller.triggerScan(
      "assessment-1",
      {
        snapshot_id: "snapshot-1",
        idempotency_key: "scan-request:assessment-1:snapshot-1:1",
      },
      {
        correlationId: "corr-1",
        scanTriggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
        pbacContext: {
          organizationId: "org-1",
          userId: "manager-1",
          subjectRole: SUBJECT_ROLES.manager,
          scope: null,
        },
      } as never,
      { status } as never,
    );

    expect(execute.mock.calls[0][0]).toBeInstanceOf(TriggerScanCommand);
    expect(execute.mock.calls[0][0]).toMatchObject({
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
      actorId: "manager-1",
      organizationId: "org-1",
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.CREATED);
  });
});
