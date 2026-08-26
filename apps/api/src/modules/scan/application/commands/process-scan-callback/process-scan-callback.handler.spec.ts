import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_RUNTIME_STAGE_CODES } from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import {
  SCAN_CALLBACK_STATUSES,
  TARGETED_REANALYSIS_REQUEST_STATES,
} from "@lcsp/contracts/scan";

import { ProcessScanCallbackHandler } from "./process-scan-callback.handler.js";
import { ProcessScanCallbackCommand } from "./process-scan-callback.command.js";

function buildHandler() {
  type RepositoryScanJobRecord = {
    id: string;
    assessmentId: string;
    snapshotId: string;
    status: string;
  };
  type TechnicalEvidenceReportRecord = {
    id: string;
    status: string;
  };
  const repositoryScanJob = {
    findUnique: jest
      .fn<() => Promise<RepositoryScanJobRecord | null>>()
      .mockImplementation(() =>
        Promise.resolve({
          id: "scan-job-1",
          assessmentId: "assessment-1",
          snapshotId: "snapshot-1",
          status: REPOSITORY_SCAN_JOB_STATUSES.running,
        }),
      ),
    updateMany: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ count: 1 })),
  };
  const technicalEvidenceReport = {
    findFirst: jest
      .fn<() => Promise<TechnicalEvidenceReportRecord | null>>()
      .mockImplementation(() => Promise.resolve(null)),
    create: jest.fn().mockImplementation(() => Promise.resolve()),
  };
  const targetedReanalysisRequest = {
    updateMany: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ count: 1 })),
  };
  const targetedReanalysisCheckpoint = {
    updateMany: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ count: 1 })),
  };
  const outboxMessage = {
    create: jest.fn().mockImplementation(() => Promise.resolve()),
  };
  const authAuditEvent = {
    create: jest.fn().mockImplementation(() => Promise.resolve()),
  };
  const transaction = {
    repositoryScanJob,
    technicalEvidenceReport,
    targetedReanalysisRequest,
    targetedReanalysisCheckpoint,
    outboxMessage,
    authAuditEvent,
  };
  const prisma = {
    repositoryScanJob,
    technicalEvidenceReport,
    $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
      Promise.resolve(handler(transaction)),
    ),
  };
  const validator = { validate: jest.fn() };
  const auditWriter = {
    write: jest.fn().mockImplementation(() => Promise.resolve()),
  };
  const storageService = {
    readAndReconstruct: jest.fn().mockImplementation(() =>
      Promise.resolve(
        JSON.stringify({
          scan_job_id: "scan-job-1",
          tools_version: { scanner: "1.0.0" },
          config_hash: { scanner: "sha256:scanner" },
          evidence_payload: { coverage_notes: [] },
          privacy_flags: {
            containsSourceCode: false,
            secretsRedacted: true,
          },
          schema_version: "1.0.0",
          status: SCAN_CALLBACK_STATUSES.success,
        }),
      ),
    ),
  };
  const runtimeEvents = {
    recordToolCompleted: jest.fn().mockImplementation(() => Promise.resolve()),
    recordToolFailed: jest.fn().mockImplementation(() => Promise.resolve()),
    recordRunCompleted: jest.fn().mockImplementation(() => Promise.resolve()),
    recordRunFailed: jest.fn().mockImplementation(() => Promise.resolve()),
  };
  return {
    handler: new ProcessScanCallbackHandler(
      prisma as never,
      validator as never,
      auditWriter as never,
      storageService as never,
      runtimeEvents as never,
    ),
    targetedReanalysisRequest,
    repositoryScanJob,
    technicalEvidenceReport,
    storageService,
    runtimeEvents,
  };
}

function callbackPayload() {
  return {
    scan_job_id: "scan-job-1",
    tools_version: { scanner: "1.0.0" },
    config_hash: { scanner: "sha256:scanner" },
    evidence_payload: { coverage_notes: [] },
    privacy_flags: {
      containsSourceCode: false,
      secretsRedacted: true,
    },
    schema_version: "1.0.0",
    status: SCAN_CALLBACK_STATUSES.success,
  };
}

describe("ProcessScanCallbackHandler targeted reanalysis completion", () => {
  it("links an accepted immutable report to the matching running reanalysis request", async () => {
    const { handler, targetedReanalysisRequest } = buildHandler();

    const response = await handler.execute(
      new ProcessScanCallbackCommand(
        "scan-job-1",
        callbackPayload(),
        "correlation-1",
      ),
    );

    expect(response.accepted).toBe(true);
    expect(targetedReanalysisRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scanJobId: "scan-job-1",
          state: TARGETED_REANALYSIS_REQUEST_STATES.running,
        },
        data: {
          state: TARGETED_REANALYSIS_REQUEST_STATES.completed,
          outputEvidenceReportId: response.evidence_report_id,
        },
      }),
    );
  });

  it("reconstructs the payload from storage service when it is an artifact reference", async () => {
    const { handler, storageService } = buildHandler();

    const payload = {
      scan_job_id: "scan-job-1",
      privacy_flags: { containsSourceCode: false, secretsRedacted: true },
      schema_version: "1.0.0",
      status: SCAN_CALLBACK_STATUSES.success,
      is_artifact_reference: true,
      artifact_manifest: {
        artifact_id: "art-1",
        total_size: 100,
        hash: "sha256-hex",
        chunks: ["chunk_0.json"],
      },
    };

    const response = await handler.execute(
      new ProcessScanCallbackCommand("scan-job-1", payload, "correlation-1"),
    );

    expect(response.accepted).toBe(true);
    expect(storageService.readAndReconstruct).toHaveBeenCalled();
  });

  it("closes scan runtime parent steps when the callback is accepted", async () => {
    const { handler, runtimeEvents } = buildHandler();

    const response = await handler.execute(
      new ProcessScanCallbackCommand(
        "scan-job-1",
        callbackPayload(),
        "correlation-1",
      ),
    );

    expect(response.accepted).toBe(true);
    expect(runtimeEvents.recordToolCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-job-1",
        correlationId: "correlation-1",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "submit_scan_callback",
        outputSummary: {
          status: SCAN_CALLBACK_STATUSES.success,
          schemaVersion: "1.0.0",
        },
      }),
    );
    expect(runtimeEvents.recordRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-job-1",
        correlationId: "correlation-1",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "repository_scan",
        outputSummary: {
          status: SCAN_CALLBACK_STATUSES.success,
          schemaVersion: "1.0.0",
        },
      }),
    );
  });

  it("fails scan runtime parent steps when the callback is rejected", async () => {
    const { handler, runtimeEvents } = buildHandler();

    const response = await handler.execute(
      new ProcessScanCallbackCommand(
        "scan-job-1",
        {
          ...callbackPayload(),
          status: SCAN_CALLBACK_STATUSES.failed,
          error_code: "SCANNER_FAILED",
        },
        "correlation-1",
      ),
    );

    expect(response.accepted).toBe(false);
    expect(runtimeEvents.recordToolFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "submit_scan_callback",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        errorSummary: "Callback rejected with status FAILED (SCANNER_FAILED)",
      }),
    );
    expect(runtimeEvents.recordRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "repository_scan",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        errorSummary: "Callback rejected with status FAILED (SCANNER_FAILED)",
      }),
    );
  });

  it("acknowledges duplicate terminal callbacks when the persisted report status matches", async () => {
    const {
      handler,
      repositoryScanJob,
      technicalEvidenceReport,
      runtimeEvents,
    } = buildHandler();
    repositoryScanJob.findUnique.mockResolvedValueOnce({
      id: "scan-job-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.failed,
    });
    technicalEvidenceReport.findFirst.mockResolvedValueOnce({
      id: "report-1",
      status: "REJECTED",
    });

    const response = await handler.execute(
      new ProcessScanCallbackCommand(
        "scan-job-1",
        {
          ...callbackPayload(),
          status: SCAN_CALLBACK_STATUSES.failed,
          error_code: "SCANNER_FAILED",
        },
        "correlation-1",
      ),
    );

    expect(response).toEqual({
      accepted: false,
      evidence_report_id: "report-1",
      correlationId: "correlation-1",
    });
    expect(technicalEvidenceReport.create).not.toHaveBeenCalled();
    expect(runtimeEvents.recordToolFailed).not.toHaveBeenCalled();
    expect(runtimeEvents.recordRunFailed).not.toHaveBeenCalled();
  });
});
