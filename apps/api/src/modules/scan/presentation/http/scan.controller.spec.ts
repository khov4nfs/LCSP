import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import { RepositoryScanJobStatus as PrismaRepositoryScanJobStatus } from "@prisma/client";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_STAGES,
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { SCAN_ERROR_CODES } from "@lcsp/contracts/scan";

import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { GetScanJobQuery } from "../../application/queries/get-scan-job/get-scan-job.query.js";
import { RerunScanCommand } from "../../application/commands/rerun-scan/rerun-scan.command.js";
import { RequestTargetedReanalysisCommand } from "../../application/commands/request-targeted-reanalysis/request-targeted-reanalysis.command.js";
import { InternalScanController, ScanController } from "./scan.controller.js";

describe("ScanController role-only RBAC", () => {
  it("allows CUSTOMER and ADMIN to read scan jobs", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.getScanJob,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin],
    });
  });

  it("requires CUSTOMER for scan reruns", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.rerunScan,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
    });
  });

  it("requires CUSTOMER for targeted reanalysis", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.requestTargetedReanalysis,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
    });
  });

  it("dispatches GetScanJobQuery with role and scope", async () => {
    const execute = jest.fn<(query: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ scan_job_id: "scan-job-1" });
    const controller = new ScanController(
      { execute } as unknown as QueryBus,
      {} as unknown as CommandBus,
    );

    await controller.getScanJob("assessment-1", "scan-job-1", {
      correlationId: "corr-1",
      rbacContext: {
        userId: "admin-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.admin,
        scope: "assessment-1",
      },
    });

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(GetScanJobQuery);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      assessmentId: "assessment-1",
      scanJobId: "scan-job-1",
      subjectRole: AUTH_USER_ROLES.admin,
      scope: "assessment-1",
      correlationId: "corr-1",
    });
  });

  it("dispatches RerunScanCommand with role-only request context", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({
      id: "new-scan-job-2",
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
    });
    const controller = new ScanController(
      {} as unknown as QueryBus,
      { execute } as unknown as CommandBus,
    );
    const rbacContext = {
      userId: "customer-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
      scope: "assessment-1",
    };

    await controller.rerunScan(
      "assessment-1",
      {
        snapshot_id: "snapshot-1",
        idempotency_key: "key-1",
        reason: "Test rerun",
      },
      { correlationId: "corr-1", rbacContext },
    );

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(RerunScanCommand);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      idempotencyKey: "key-1",
      rbacContext,
      correlationId: "corr-1",
      reason: "Test rerun",
    });
  });

  it("dispatches targeted reanalysis with role-only request context", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ status: "READY" });
    const controller = new ScanController(
      {} as unknown as QueryBus,
      { execute } as unknown as CommandBus,
    );
    const rbacContext = {
      userId: "customer-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
      scope: "assessment-1",
    };

    await controller.requestTargetedReanalysis(
      "assessment-1",
      "ter_12345678",
      {
        inputArtifactVersion: "ter_12345678",
        analyzerId: "DEEP_AGENT_REPOSITORY_ANALYSIS",
        scope: {
          ruleScope: {
            engineeringRuleId: "ENG-1",
            criterionIds: ["criterion-a"],
            contextRevision: 1,
          },
        },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      { correlationId: "corr-1", rbacContext },
    );

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      RequestTargetedReanalysisCommand,
    );
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      input: {
        assessmentId: "assessment-1",
        inputArtifactVersion: "ter_12345678",
      },
      rbacContext,
      correlationId: "corr-1",
    });
  });
});

describe("InternalScanController", () => {
  it("claims a queued scan job when Agent Runtime accepts the boundary", async () => {
    const recordRepositoryAnalysisEvent = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue({ recorded: true });
    const updateMany = jest
      .fn<(args: unknown) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({
        id: "scan-1",
        status: PrismaRepositoryScanJobStatus.QUEUED,
        attemptCount: 0,
      })
      .mockResolvedValueOnce({
        status: PrismaRepositoryScanJobStatus.RUNNING,
        attemptCount: 1,
      });
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      { recordRepositoryAnalysisEvent } as never,
      { repositoryScanJob: { findUnique, updateMany } } as never,
      { get: () => false } as never,
    );

    const result = await controller.claimScanJob("scan-1", {
      boundary_name: "scan_requested",
      timeout_seconds: 1800,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "scan-1",
        status: PrismaRepositoryScanJobStatus.QUEUED,
      },
      data: {
        status: PrismaRepositoryScanJobStatus.RUNNING,
        blockedReason: null,
        attemptCount: { increment: 1 },
      },
    });
    expect(recordRepositoryAnalysisEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        toolName: "agent_runtime",
        attempt: 1,
        inputSummary: expect.objectContaining({
          boundaryName: "scan_requested",
          timeoutSeconds: 1800,
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        claimed: true,
        terminal: false,
        status: REPOSITORY_SCAN_JOB_STATUSES.running,
      },
    });
  });

  it("terminalizes an active scan job with a safe runtime failure reason", async () => {
    const recordRepositoryAnalysisEvent = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue({ recorded: true });
    const updateMany = jest
      .fn<(args: unknown) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const findUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      status: PrismaRepositoryScanJobStatus.FAILED,
      assessmentId: "assessment-1",
    });
    const execute = jest
      .fn<(command: unknown) => Promise<unknown>>()
      .mockResolvedValue({ releasedReservationIds: ["hold-1"] });
    const controller = new InternalScanController(
      { execute } as unknown as CommandBus,
      { recordRepositoryAnalysisEvent } as never,
      { repositoryScanJob: { findUnique, updateMany } } as never,
      { get: () => false } as never,
    );

    const result = await controller.markScanJobTerminalFailure("scan-1", {
      boundary_name: "scan_requested",
      reason_code: SCAN_ERROR_CODES.agentRuntimeBoundaryTimeout,
      timeout_seconds: 1800,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "scan-1",
        status: {
          in: [
            PrismaRepositoryScanJobStatus.QUEUED,
            PrismaRepositoryScanJobStatus.RUNNING,
          ],
        },
      },
      data: {
        status: PrismaRepositoryScanJobStatus.FAILED,
        blockedReason: SCAN_ERROR_CODES.agentRuntimeBoundaryTimeout,
      },
    });
    expect(recordRepositoryAnalysisEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runFailed,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
        toolName: "agent_runtime",
        errorSummary: SCAN_ERROR_CODES.agentRuntimeBoundaryTimeout,
        outputSummary: expect.objectContaining({
          errorCode: SCAN_ERROR_CODES.agentRuntimeBoundaryTimeout,
          boundaryName: "scan_requested",
          timeoutSeconds: 1800,
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        terminalized: true,
        status: REPOSITORY_SCAN_JOB_STATUSES.failed,
        reasonCode: SCAN_ERROR_CODES.agentRuntimeBoundaryTimeout,
      },
    });
  });

  it("does not expose arbitrary worker failure strings as scan failure reasons", async () => {
    const updateMany = jest
      .fn<(args: unknown) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      { recordRepositoryAnalysisEvent: jest.fn() } as never,
      {
        repositoryScanJob: {
          updateMany,
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            status: PrismaRepositoryScanJobStatus.FAILED,
          }),
        },
      } as never,
      { get: () => false } as never,
    );

    const result = await controller.markScanJobTerminalFailure("scan-1", {
      reason_code: "raw provider exception with token sk-should-not-leak",
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blockedReason: SCAN_ERROR_CODES.repositoryAnalysisFailed,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          reasonCode: SCAN_ERROR_CODES.repositoryAnalysisFailed,
        }),
      }),
    );
  });

  it("creates targeted reanalysis with a synthetic CUSTOMER worker context", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ status: "READY" });
    const controller = new InternalScanController(
      { execute } as unknown as CommandBus,
      {} as never,
      {} as never,
      { get: () => false } as never,
    );

    await controller.createTargetedReanalysis(
      {
        assessmentId: "assessment-1",
        userId: "user-1",
        inputArtifactVersion: "ter_12345678",
        analyzerId: "DEEP_AGENT_REPOSITORY_ANALYSIS",
        scope: {
          ruleScope: {
            engineeringRuleId: "ENG-1",
            criterionIds: ["criterion-a"],
            contextRevision: 1,
          },
        },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      "corr-1",
    );

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      RequestTargetedReanalysisCommand,
    );
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      rbacContext: {
        userId: "user-1",
        sessionId: "worker-runtime",
        role: AUTH_USER_ROLES.customer,
        scope: "assessment-1",
      },
      correlationId: "corr-1",
    });
  });
  it("publishes worker agent stream events without trimming streamed text", async () => {
    const publishAgentStreamEvent = jest.fn((value: unknown) =>
      Promise.resolve({
        ...(value as object),
        eventId: "agent-event-1",
      }),
    );
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      { publishAgentStreamEvent } as never,
      {} as never,
      { get: () => false } as never,
    );

    const result = await controller.recordAgentStreamEvent(
      {
        assessment_id: "assessment-1",
        run_id: "run-1",
        event_type: "MODEL_CONTENT_DELTA",
        agent_name: "planner",
        text: " token \n",
      },
      "corr-header",
    );

    expect(publishAgentStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "run-1",
        correlationId: "corr-header",
        eventType: "MODEL_CONTENT_DELTA",
        agentName: "planner",
        text: " token \n",
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { recorded: true, eventId: "agent-event-1" },
    });
  });

  it("keeps the worker's pipeline stage so each stage streams on its own timeline", async () => {
    const publishAgentStreamEvent = jest.fn((value: unknown) =>
      Promise.resolve({ ...(value as object), eventId: "agent-event-stage" }),
    );
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      { publishAgentStreamEvent } as never,
      {} as never,
      { get: () => false } as never,
    );

    await controller.recordAgentStreamEvent(
      {
        assessment_id: "assessment-1",
        run_id: "run-1",
        event_type: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
        stage: ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis,
      },
      "corr-header",
    );
    await controller.recordAgentStreamEvent(
      {
        assessment_id: "assessment-1",
        run_id: "run-1",
        event_type: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
        stage: "not-a-stage",
      },
      "corr-header",
    );

    expect(publishAgentStreamEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stage: ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis,
      }),
    );
    expect(publishAgentStreamEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ stage: null }),
    );
  });

  it("accepts model-call telemetry events from the worker stream", async () => {
    const publishAgentStreamEvent = jest.fn((value: unknown) =>
      Promise.resolve({
        ...(value as object),
        eventId: "agent-event-model-call",
      }),
    );
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      { publishAgentStreamEvent } as never,
      {} as never,
      { get: () => false } as never,
    );

    const result = await controller.recordAgentStreamEvent(
      {
        assessment_id: "assessment-1",
        run_id: "run-1",
        event_type: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout,
        node_name: "model",
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
        text: "model call timed out",
        data: {
          provider: "google_genai",
          model: "gemini-3.5-flash-lite",
          elapsed_seconds: 30,
          timeout_seconds: 30,
        },
      },
      "corr-header",
    );

    expect(publishAgentStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "run-1",
        correlationId: "corr-header",
        eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout,
        nodeName: "model",
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
        text: "model call timed out",
        data: expect.objectContaining({
          provider: "google_genai",
          model: "gemini-3.5-flash-lite",
          elapsed_seconds: 30,
          timeout_seconds: 30,
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { recorded: true, eventId: "agent-event-model-call" },
    });
  });

  it("persists bounded decision-model events by exact PR head correlation", async () => {
    const create = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue({});
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      {} as never,
      { decisionModelEvent: { create } } as never,
      { get: () => false } as never,
    );

    await controller.recordDecisionModelEvent({
      eventType: "DECISION_MODEL_RESULT",
      decisionId:
        "review-triage-v1:344:95ba2ee36a1c1df449c4b2a280644b234a0e5a84",
      decisionType: "PR_REVIEW_TRIAGE",
      prNumber: 344,
      headSha: "95ba2ee36a1c1df449c4b2a280644b234a0e5a84",
      data: {
        provider: "typesafe",
        prompt: "must not be trusted as raw prompt authority",
      },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decisionId:
          "review-triage-v1:344:95ba2ee36a1c1df449c4b2a280644b234a0e5a84",
        decisionType: "PR_REVIEW_TRIAGE",
        eventType: "DECISION_MODEL_RESULT",
        prNumber: 344,
        headSha: "95ba2ee36a1c1df449c4b2a280644b234a0e5a84",
        payloadJson: expect.objectContaining({
          eventType: "DECISION_MODEL_RESULT",
          decisionType: "PR_REVIEW_TRIAGE",
          data: expect.objectContaining({ provider: "typesafe" }),
        }),
      }),
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payloadJson: expect.objectContaining({
          data: expect.not.objectContaining({
            prompt: expect.anything(),
          }),
        }),
      }),
    });
  });

  it("mirrors safe decision-model events through the durable agent stream", async () => {
    const create = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue({});
    const publishAgentStreamEvent = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue({ eventId: "agent-event-1" });
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      { publishAgentStreamEvent } as never,
      { decisionModelEvent: { create } } as never,
      { get: () => false } as never,
    );

    await controller.recordDecisionModelEvent({
      eventType: "DECISION_MODEL_RESULT",
      decisionId: "investigator-action-v1:assessment-1:run-1:checkpoint-1",
      decisionType: "INVESTIGATOR_NEXT_ACTION",
      assessmentId: "assessment-1",
      reviewRunId: "run-1",
      checkpointId: "checkpoint-1",
      data: {
        provider: "jev",
        modelVersion: "jev-2026-09-22",
        policyVersion: "jev-shadow-v1",
        questionResults: [
          {
            questionId: "next_action",
            questionType: "CHOICE",
            selectedChoice: "TRACE_STATIC_FLOW",
            probability: 0.87,
            probabilities: {
              TRACE_STATIC_FLOW: 0.87,
              REQUEST_TARGETED_INPUT: 0.08,
              CHECK_RUNTIME_EVIDENCE: 0.05,
            },
            confidence: 0.87,
            prompt: "raw private prompt",
            secret: "decision-secret",
            privateContext: "customer-specific content",
          },
        ],
        selectedTypedResult: {
          next_action: "TRACE_STATIC_FLOW",
          privateContext: "customer-specific content",
        },
        shadowProposedAction: "TRACE_STATIC_FLOW",
        authoritativeAction: "TRACE_STATIC_FLOW",
        agreement: true,
        confidence: 0.87,
        thresholdUsed: 0.85,
        decisionMode: "SHADOW",
        latencyMs: 174,
        usage: {
          inputTokens: 46,
          outputTokens: 8,
          costUsd: 0.00023,
          prompt: "raw private prompt",
        },
        prompt: "must not be projected",
      },
    });

    expect(publishAgentStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "run-1",
        eventType: "DECISION_MODEL_RESULT",
        source: "jev_decision_gateway",
        data: expect.objectContaining({
          kind: "DECISION_MODEL",
          provider: "jev",
          model: "jev-2026-09-22",
          shadowProposedAction: "TRACE_STATIC_FLOW",
          authoritativeAction: "TRACE_STATIC_FLOW",
          confidence: 0.87,
          resultSummary: expect.objectContaining({
            questionResults: [
              expect.objectContaining({
                questionId: "next_action",
                probabilities: expect.objectContaining({
                  TRACE_STATIC_FLOW: 0.87,
                  REQUEST_TARGETED_INPUT: 0.08,
                }),
              }),
            ],
            selectedTypedResult: expect.objectContaining({
              next_action: "TRACE_STATIC_FLOW",
            }),
          }),
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payloadJson: expect.objectContaining({
          data: expect.not.objectContaining({ prompt: expect.anything() }),
        }),
      }),
    });
    const persistedPayload = (
      create.mock.calls[0]?.[0] as {
        data?: { payloadJson?: { data?: Record<string, unknown> } };
      }
    ).data?.payloadJson?.data;
    const streamPayload = (
      publishAgentStreamEvent.mock.calls[0]?.[0] as {
        data?: { resultSummary?: Record<string, unknown> };
      }
    ).data?.resultSummary;
    expect(JSON.stringify(persistedPayload)).not.toContain(
      "raw private prompt",
    );
    expect(JSON.stringify(persistedPayload)).not.toContain("decision-secret");
    expect(JSON.stringify(persistedPayload)).not.toContain(
      "customer-specific content",
    );
    expect(JSON.stringify(streamPayload)).not.toContain("raw private prompt");
    expect(JSON.stringify(streamPayload)).not.toContain("decision-secret");
    expect(JSON.stringify(streamPayload)).not.toContain(
      "customer-specific content",
    );
  });

  it("claims decision IDs once and reports replay duplicates without provider authority", async () => {
    const create = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ code: "P2002" });
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      {} as never,
      { decisionModelDecision: { create } } as never,
      { get: () => false } as never,
    );

    const first = await controller.claimDecisionModelRequest(
      "root-route-v1:a:r:c",
      {
        decisionType: "ROOT_NON_DETERMINISTIC_NEXT_STAGE",
        assessmentId: "assessment-1",
        reviewRunId: "run-1",
      },
    );
    const replay = await controller.claimDecisionModelRequest(
      "root-route-v1:a:r:c",
      {
        decisionType: "ROOT_NON_DETERMINISTIC_NEXT_STAGE",
        assessmentId: "assessment-1",
        reviewRunId: "run-1",
      },
    );

    expect(first).toEqual({ ok: true, data: { claimed: true } });
    expect(replay).toEqual({ ok: true, data: { claimed: false } });
  });

  it("completes decision records with bounded shadow comparison only", async () => {
    const upsert = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue({});
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      {} as never,
      { decisionModelDecision: { upsert } } as never,
      { get: () => false } as never,
    );

    await controller.completeDecisionModelRequest(
      "interview-topic-v1:a:r:rev-2",
      {
        decisionId: "interview-topic-v1:a:r:rev-2",
        decisionType: "INTERVIEW_TOPIC_ROUTING",
        authoritativeAction: "DEPLOYMENT",
        shadowProposedAction: "DATA_SOURCE",
        agreement: false,
        confidence: 0.81,
        skipped: false,
      },
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { decisionId: "interview-topic-v1:a:r:rev-2" },
      create: expect.objectContaining({
        decisionId: "interview-topic-v1:a:r:rev-2",
        decisionType: "INTERVIEW_TOPIC_ROUTING",
        resultJson: expect.objectContaining({
          authoritativeAction: "DEPLOYMENT",
          shadowProposedAction: "DATA_SOURCE",
          agreement: false,
          confidence: 0.81,
          skipped: false,
        }),
      }),
      update: expect.objectContaining({
        resultJson: expect.objectContaining({
          authoritativeAction: "DEPLOYMENT",
          shadowProposedAction: "DATA_SOURCE",
        }),
      }),
    });
  });
});
