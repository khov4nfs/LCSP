import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

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
        analyzerId: "RUN_TS_JS_SEMANTIC_ANALYSIS",
        scope: { pathPrefixes: ["src/web/"] },
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
  it("creates targeted reanalysis with a synthetic CUSTOMER worker context", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ status: "READY" });
    const controller = new InternalScanController(
      { execute } as unknown as CommandBus,
      {} as never,
      {} as never,
    );

    await controller.createTargetedReanalysis(
      {
        assessmentId: "assessment-1",
        userId: "user-1",
        inputArtifactVersion: "ter_12345678",
        analyzerId: "RUN_SEMGREP_RULES",
        scope: { pathPrefixes: ["apps/api/"] },
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

  it("persists bounded decision-model events by exact PR head correlation", async () => {
    const create = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue({});
    const controller = new InternalScanController(
      {} as unknown as CommandBus,
      {} as never,
      { decisionModelEvent: { create } } as never,
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
