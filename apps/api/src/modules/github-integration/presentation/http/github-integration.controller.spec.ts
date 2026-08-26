import { describe, expect, it, jest } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import type { CommandBus } from "@nestjs/cqrs";

import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { PinSnapshotCommand } from "../../application/commands/pin-snapshot/pin-snapshot.command.js";
import { TriggerScanCommand } from "../../application/commands/trigger-scan/trigger-scan.command.js";
import type { TriggerScanDto } from "../../application/contracts/github-integration/trigger-scan.contract.js";
import { GitHubIntegrationController } from "./github-integration.controller.js";

describe("GitHubIntegrationController.pinSnapshot", () => {
  it("requires CUSTOMER role", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      GitHubIntegrationController.prototype.pinSnapshot,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
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
      { connection_id: "connection-1", branch: "main" },
      {
        correlationId: "corr-1",
        rbacContext: {
          userId: "customer-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: null,
        },
      } as never,
    );

    expect(execute.mock.calls[0][0]).toBeInstanceOf(PinSnapshotCommand);
    expect(execute.mock.calls[0][0]).toMatchObject({
      assessmentId: "assessment-1",
      actorId: "customer-1",
      connectionId: "connection-1",
      branch: "main",
      correlationId: "corr-1",
    });
  });
});

describe("GitHubIntegrationController.triggerScan", () => {
  it("requires CUSTOMER role", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      GitHubIntegrationController.prototype.triggerScan,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
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
        rbacContext: {
          userId: "customer-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
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
      actorId: "customer-1",
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.CREATED);
  });
});
