import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import {
  PBAC_ACTIONS,
  PBAC_METADATA_TYPES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import { SCAN_CALLBACK_STATUSES } from "@lcsp/contracts/scan";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

import { PBAC_METADATA_KEY } from "../../../../platform/pbac/decorators/pbac-metadata.js";
import { GetScanJobQuery } from "../../application/queries/get-scan-job/get-scan-job.query.js";
import { ProcessScanCallbackCommand } from "../../application/commands/process-scan-callback/process-scan-callback.command.js";
import { RerunScanCommand } from "../../application/commands/rerun-scan/rerun-scan.command.js";
import { InternalScanController, ScanController } from "./scan.controller.js";
import { InternalTargetedReanalysisController } from "./scan.controller.js";
import { TARGETED_REANALYSIS_REQUEST_STATES } from "@lcsp/contracts/scan";

describe("ScanController", () => {
  it("requires the scan:read PBAC action", () => {
    const metadata = Reflect.getMetadata(
      PBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.getScanJob,
    ) as unknown;

    expect(metadata).toEqual({
      type: PBAC_METADATA_TYPES.action,
      action: PBAC_ACTIONS.scanRead,
    });
  });

  it("dispatches GetScanJobQuery with organization and Developer scope", async () => {
    const execute = jest.fn<(query: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ scan_job_id: "scan-job-1" });
    const controller = new ScanController(
      { execute } as unknown as QueryBus,
      {} as unknown as CommandBus,
    );

    await controller.getScanJob("assessment-1", "scan-job-1", {
      correlationId: "corr-1",
      pbacContext: {
        userId: "developer-1",
        sessionId: "session-1",
        organizationId: "org-1",
        subjectRole: SUBJECT_ROLES.developer,
        scope: "assessment-1",
        grantedActions: [PBAC_ACTIONS.scanRead],
        selectedAction: PBAC_ACTIONS.scanRead,
        policyId: "policy-developer",
        policyVersion: "v1",
      },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(GetScanJobQuery);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      assessmentId: "assessment-1",
      scanJobId: "scan-job-1",
      organizationId: "org-1",
      subjectRole: SUBJECT_ROLES.developer,
      scope: "assessment-1",
      correlationId: "corr-1",
    });
  });

  it("requires the scan:trigger PBAC action for rerunScan", () => {
    const metadata = Reflect.getMetadata(
      PBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.rerunScan,
    ) as unknown;

    expect(metadata).toEqual({
      type: PBAC_METADATA_TYPES.action,
      action: PBAC_ACTIONS.scanTrigger,
    });
  });

  it("dispatches RerunScanCommand with correct arguments", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({
      id: "new-scan-job-2",
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
    });
    const controller = new ScanController(
      {} as unknown as QueryBus,
      { execute } as unknown as CommandBus,
    );

    const pbacContext = {
      userId: "manager-1",
      sessionId: "session-1",
      organizationId: "org-1",
      subjectRole: SUBJECT_ROLES.manager,
      scope: "assessment-1",
      grantedActions: [PBAC_ACTIONS.scanTrigger],
      selectedAction: PBAC_ACTIONS.scanTrigger,
      policyId: "policy-manager",
      policyVersion: "v1",
    };

    await controller.rerunScan(
      "assessment-1",
      {
        snapshot_id: "snapshot-1",
        idempotency_key: "key-1",
        reason: "Test rerun",
      },
      {
        correlationId: "corr-1",
        pbacContext,
      },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(RerunScanCommand);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      idempotencyKey: "key-1",
      pbacContext,
      correlationId: "corr-1",
      reason: "Test rerun",
    });
  });
});

describe("InternalScanController", () => {
  it("dispatches the worker callback command", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ accepted: true });
    const controller = new InternalScanController({
      execute,
    } as unknown as CommandBus);
    const payload = {
      scan_job_id: "scan-job-1",
      tools_version: { semgrep: "1.0.0" },
      config_hash: { semgrep: "sha256:abc" },
      evidence_payload: { findings: [] },
      privacy_flags: {
        containsSourceCode: false,
        secretsRedacted: true,
      },
      schema_version: "1.0.0",
      status: SCAN_CALLBACK_STATUSES.success,
    };

    await controller.processCallback("scan-job-1", payload, "corr-1");

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      ProcessScanCallbackCommand,
    );
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      scanJobId: "scan-job-1",
      payload,
      correlationId: "corr-1",
    });
  });
});

describe("InternalTargetedReanalysisController", () => {
  it("claims only a dispatched request while atomically enforcing the per-organization running limit", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      organizationId: "org-1",
      state: TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
    });
    const count = jest.fn().mockResolvedValue(1);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const $executeRaw = jest.fn().mockResolvedValue(undefined);
    const transaction = {
      targetedReanalysisRequest: { findUnique, count, updateMany },
      targetedReanalysisCheckpoint: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw,
    };
    const prisma = {
      $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
        Promise.resolve(handler(transaction)),
      ),
    };
    const controller = new InternalTargetedReanalysisController(
      prisma as never,
      { write: jest.fn().mockResolvedValue(undefined) } as never,
    );

    const response = await controller.claimRequest("request-1");

    expect(response).toEqual({ ok: true, data: { claimed: true } });
    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "request-1",
        state: TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
      },
      data: {
        state: TARGETED_REANALYSIS_REQUEST_STATES.running,
        workerDeliveryAttempts: { increment: 1 },
      },
    });
  });

  it("does not claim a queued request injected outside the outbox scheduler", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      organizationId: "org-1",
      state: TARGETED_REANALYSIS_REQUEST_STATES.queued,
    });
    const transaction = {
      targetedReanalysisRequest: { findUnique },
      targetedReanalysisCheckpoint: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: jest.fn(),
    };
    const prisma = {
      $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
        Promise.resolve(handler(transaction)),
      ),
    };
    const controller = new InternalTargetedReanalysisController(
      prisma as never,
      { write: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(controller.claimRequest("request-1")).resolves.toEqual({
      ok: true,
      data: { claimed: false },
    });
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });
});
