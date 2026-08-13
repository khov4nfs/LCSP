import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import {
  PBAC_ACTIONS,
  PBAC_METADATA_TYPES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import { SCAN_CALLBACK_STATUSES, SCAN_EVENT_TYPES } from "@lcsp/contracts/scan";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

import { PBAC_METADATA_KEY } from "../../../../platform/pbac/decorators/pbac-metadata.js";
import { GetScanJobQuery } from "../../application/queries/get-scan-job/get-scan-job.query.js";
import { ProcessScanCallbackCommand } from "../../application/commands/process-scan-callback/process-scan-callback.command.js";
import { RerunScanCommand } from "../../application/commands/rerun-scan/rerun-scan.command.js";
import { RequestTargetedReanalysisCommand } from "../../application/commands/request-targeted-reanalysis/request-targeted-reanalysis.command.js";
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

  it("requires the technical-evidence:reanalyze PBAC action for requestTargetedReanalysis", () => {
    const metadata = Reflect.getMetadata(
      PBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.requestTargetedReanalysis,
    ) as unknown;

    expect(metadata).toEqual({
      type: PBAC_METADATA_TYPES.action,
      action: PBAC_ACTIONS.technicalEvidenceReanalyze,
    });
  });

  it("dispatches RequestTargetedReanalysisCommand with the packet-shaped body", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({
      status: "READY",
      toolName: "request_targeted_reanalysis",
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
      grantedActions: [PBAC_ACTIONS.technicalEvidenceReanalyze],
      selectedAction: PBAC_ACTIONS.technicalEvidenceReanalyze,
      policyId: "policy-manager",
      policyVersion: "v1",
    };

    await controller.requestTargetedReanalysis(
      "assessment-1",
      "ter_12345678",
      {
        inputArtifactVersion: "ter_12345678",
        analyzerId: "RUN_TS_JS_SEMANTIC_ANALYSIS",
        scope: { pathPrefixes: ["src/web/"] },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      {
        correlationId: "corr-1",
        pbacContext,
      },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      RequestTargetedReanalysisCommand,
    );
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      input: {
        assessmentId: "assessment-1",
        inputArtifactVersion: "ter_12345678",
        analyzerId: "RUN_TS_JS_SEMANTIC_ANALYSIS",
        scope: { pathPrefixes: ["src/web/"] },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      pbacContext,
      correlationId: "corr-1",
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

  it("creates targeted reanalysis through the internal worker-auth endpoint", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ status: "READY" });
    const controller = new InternalScanController({
      execute,
    } as unknown as CommandBus);

    await controller.createTargetedReanalysis(
      {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        userId: "user-1",
        inputArtifactVersion: "ter_12345678",
        analyzerId: "RUN_SEMGREP_RULES",
        scope: { pathPrefixes: ["apps/api/"] },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      "corr-1",
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      RequestTargetedReanalysisCommand,
    );
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      input: {
        assessmentId: "assessment-1",
        inputArtifactVersion: "ter_12345678",
        analyzerId: "RUN_SEMGREP_RULES",
        scope: { pathPrefixes: ["apps/api/"] },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      pbacContext: expect.objectContaining({
        userId: "user-1",
        organizationId: "org-1",
        selectedAction: PBAC_ACTIONS.technicalEvidenceReanalyze,
      }),
      correlationId: "corr-1",
    });
  });
});

describe("InternalTargetedReanalysisController", () => {
  it("claims only a dispatched request while atomically enforcing the per-organization running limit", async () => {
    const findUnique = jest.fn().mockImplementation(() =>
      Promise.resolve({
        organizationId: "org-1",
        assessmentId: "assessment-1",
        correlationId: "correlation-1",
        state: TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
      }),
    );
    const count = jest.fn().mockImplementation(() => Promise.resolve(1));
    const updateMany = jest
      .fn()
      .mockImplementation(() => Promise.resolve({ count: 1 }));
    const $executeRaw = jest.fn().mockImplementation(() => Promise.resolve());
    const transaction = {
      targetedReanalysisRequest: { findUnique, count, updateMany },
      targetedReanalysisCheckpoint: {
        updateMany: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ count: 1 })),
      },
      $executeRaw,
    };
    const prisma = {
      $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
        Promise.resolve(handler(transaction)),
      ),
    };
    const auditWriter = {
      write: jest.fn().mockImplementation(() => Promise.resolve()),
    };
    const controller = new InternalTargetedReanalysisController(
      prisma as never,
      auditWriter as never,
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
    expect(auditWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        assessmentId: "assessment-1",
        correlationId: "correlation-1",
      }),
    );
  });

  it("does not claim a queued request injected outside the outbox scheduler", async () => {
    const findUnique = jest.fn().mockImplementation(() =>
      Promise.resolve({
        organizationId: "org-1",
        state: TARGETED_REANALYSIS_REQUEST_STATES.queued,
      }),
    );
    const transaction = {
      targetedReanalysisRequest: { findUnique },
      targetedReanalysisCheckpoint: {
        updateMany: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ count: 1 })),
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
      { write: jest.fn().mockImplementation(() => Promise.resolve()) } as never,
    );

    await expect(controller.claimRequest("request-1")).resolves.toEqual({
      ok: true,
      data: { claimed: false },
    });
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it("audits terminal and retry transitions with only the safe request reference", async () => {
    const updateMany = jest
      .fn()
      .mockImplementation(() => Promise.resolve({ count: 1 }));
    const checkpointUpdate = jest
      .fn()
      .mockImplementation(() => Promise.resolve({ count: 1 }));
    const auditWriter = {
      write: jest.fn().mockImplementation(() => Promise.resolve()),
    };
    const prisma = {
      targetedReanalysisRequest: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            organizationId: "org-1",
            assessmentId: "assessment-1",
            correlationId: "correlation-1",
          }),
        ),
        updateMany,
      },
      targetedReanalysisCheckpoint: { updateMany: checkpointUpdate },
    };
    const controller = new InternalTargetedReanalysisController(
      prisma as never,
      auditWriter as never,
    );

    await controller.requeueRequest("request-1");
    await controller.setTerminalState("request-1", {
      state: TARGETED_REANALYSIS_REQUEST_STATES.failed,
      safe_failure_code: "SAFE_FAILURE",
    });

    expect(auditWriter.write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.targetedReanalysisRetryAudit,
        resourceId: "request-1",
        payload: { requestId: "request-1" },
      }),
    );
    expect(auditWriter.write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.targetedReanalysisTerminalAudit,
        resourceId: "request-1",
        payload: { requestId: "request-1" },
      }),
    );
  });
});
