import { describe, expect, it, jest } from "@jest/globals";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import {
  SCAN_CALLBACK_STATUSES,
  TARGETED_REANALYSIS_REQUEST_STATES,
} from "@lcsp/contracts/scan";

import { ProcessScanCallbackHandler } from "./process-scan-callback.handler.js";
import { ProcessScanCallbackCommand } from "./process-scan-callback.command.js";

function buildHandler() {
  const repositoryScanJob = {
    findUnique: jest.fn().mockResolvedValue({
      id: "scan-job-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      organizationId: "org-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.running,
    }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const technicalEvidenceReport = {
    create: jest.fn().mockResolvedValue(undefined),
  };
  const targetedReanalysisRequest = {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const targetedReanalysisCheckpoint = {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const outboxMessage = { create: jest.fn().mockResolvedValue(undefined) };
  const authAuditEvent = { create: jest.fn().mockResolvedValue(undefined) };
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
    $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
      Promise.resolve(handler(transaction)),
    ),
  };
  const validator = { validate: jest.fn() };
  const auditWriter = { write: jest.fn().mockResolvedValue(undefined) };
  return {
    handler: new ProcessScanCallbackHandler(
      prisma as never,
      validator as never,
      auditWriter as never,
    ),
    targetedReanalysisRequest,
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
});
