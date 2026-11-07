import { describe, expect, it } from "@jest/globals";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_SESSION_DURATION_MEASUREMENTS } from "@lcsp/contracts/assessment-domain";
import { LLM_USAGE_STATUSES } from "@lcsp/contracts/billing";
import { ASSESSMENT_AGENT_STREAM_EVENT_TYPES as STREAM } from "@lcsp/contracts/evidence";
import {
  summarizeSessionDurations,
  summarizeSessionTokenUsage,
  summarizeSessionTools,
} from "./assessment-session-metrics.js";

describe("assessment-session-metrics", () => {
  describe("summarizeSessionDurations", () => {
    it("preserves observed spans without certifying active duration on a completed assessment", () => {
      const turns = [
        {
          id: "turn-1",
          state: "COMPLETED",
          createdAt: "2026-11-01T00:00:00Z",
          updatedAt: "2026-11-01T00:00:02Z",
        },
        {
          id: "turn-2",
          state: "COMPLETED",
          createdAt: "2026-11-01T00:00:05Z",
          updatedAt: "2026-11-01T00:00:08Z",
        },
      ];
      const events = [
        {
          eventType:
            AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
          payload: { toState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE },
          timestamp: "2026-11-01T00:00:08Z",
        },
      ];
      const result = summarizeSessionDurations(turns, events, {
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      });
      expect(result.wallDurationMs).toBe(8000);
      expect(result.observedRunningDurationMs).toBe(5000);
      expect(result.activeDurationMs).toBeNull();
      expect(result.durationMeasurement).toBe(
        ASSESSMENT_SESSION_DURATION_MEASUREMENTS.OBSERVED_TURN_SPANS,
      );
      expect(result.durationCoverage.activeDurationAuthoritative).toBe(false);
      expect(result.executionSegments).toHaveLength(2);
    });

    it("never substitutes a mutable assessment updatedAt for completion evidence", () => {
      const result = summarizeSessionDurations([], [], {
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
        runtime: { startedAt: "2026-11-01T00:00:00Z" },
        updatedAt: "2026-11-01T00:01:00Z",
      });
      expect(result.wallDurationMs).toBeNull();
      expect(result.completedAt).toBeNull();
      expect(result.observedRunningDurationMs).toBeNull();
      expect(result.durationMeasurement).toBe(
        ASSESSMENT_SESSION_DURATION_MEASUREMENTS.UNAVAILABLE,
      );
    });

    it("preserves invalid and running turns without turning missing measurements into zero", () => {
      const turns = [
        { id: "missing", state: "RUNNING", createdAt: null, updatedAt: null },
        {
          id: "reversed",
          state: "COMPLETED",
          createdAt: "2026-11-01T00:00:05Z",
          updatedAt: "2026-11-01T00:00:02Z",
        },
        {
          id: "invalid",
          state: "RUNNING",
          createdAt: "invalid",
          updatedAt: "invalid",
        },
      ];
      const result = summarizeSessionDurations(turns, [], {});
      expect(result.observedRunningDurationMs).toBeNull();
      expect(result.activeDurationMs).toBeNull();
      expect(result.durationCoverage.invalidOrMissingTurnSpans).toBe(3);
      expect(result.executionSegments.map((row) => row.durationMs)).toEqual([
        null,
        null,
        null,
      ]);
      expect(result.executionSegments[2].startedAt).toBe("invalid");
    });

    it("allows wall-only evidence and explicitly measured zero-length spans", () => {
      const events = [
        {
          eventType:
            AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
          payload: { toState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE },
          timestamp: "2026-11-01T00:00:08Z",
        },
      ];
      const wall = summarizeSessionDurations([], events, {
        runtime: { startedAt: "2026-11-01T00:00:00Z" },
      });
      expect(wall.wallDurationMs).toBe(8000);
      expect(wall.durationMeasurement).toBe(
        ASSESSMENT_SESSION_DURATION_MEASUREMENTS.WALL_ONLY,
      );
      const zero = summarizeSessionDurations(
        [
          {
            createdAt: "2026-11-01T00:00:00Z",
            updatedAt: "2026-11-01T00:00:00Z",
          },
        ],
        [],
        {},
      );
      expect(zero.observedRunningDurationMs).toBe(0);
      expect(zero.activeDurationMs).toBeNull();
    });
  });

  describe("summarizeSessionTokenUsage", () => {
    it("keeps empty or entirely missing measurements unknown", () => {
      for (const rows of [[], [{ status: LLM_USAGE_STATUSES.SETTLED }]]) {
        const result = summarizeSessionTokenUsage(rows);
        expect(result.totalTokens).toBeNull();
        expect(result.cachedTokens).toBeNull();
        expect(result.observedTotals.totalTokens).toBeNull();
        expect(result.observedTotals.coverage.exhaustive).toBe(false);
        expect(result.observedTotals.coverage.eventsCount).toBe(rows.length);
      }
    });

    it("sums complete provider measurements without adding cache tokens twice", () => {
      const result = summarizeSessionTokenUsage([
        {
          status: LLM_USAGE_STATUSES.SETTLED,
          inputTokens: 100n,
          outputTokens: 50n,
          totalTokens: 150n,
          cachedInputTokens: 20n,
          reasoningTokens: 10n,
        },
        {
          status: LLM_USAGE_STATUSES.SETTLED,
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          cachedInputTokens: 30,
          reasoningTokens: 20,
        },
      ]);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
      expect(result.totalTokens).toBe(450);
      expect(result.cachedTokens).toBe(50);
      expect(result.reasoningTokens).toBe(30);
      expect(result.observedTotals.coverage.exhaustive).toBe(true);
    });

    it("exports partial totals only as observed values with per-metric coverage", () => {
      const result = summarizeSessionTokenUsage([
        {
          status: LLM_USAGE_STATUSES.SETTLED,
          inputTokens: 100n,
          totalTokens: 150n,
        },
        {
          status: LLM_USAGE_STATUSES.SETTLED,
          inputTokens: 200n,
          totalTokens: null,
        },
      ]);
      expect(result.inputTokens).toBe(300);
      expect(result.totalTokens).toBeNull();
      expect(result.outputTokens).toBeNull();
      expect(result.observedTotals.totalTokens).toBe(150);
      expect(result.observedTotals.outputTokens).toBeNull();
      expect(result.observedTotals.coverage.metrics.totalTokens).toMatchObject({
        exhaustive: false,
        reportedEvents: 1,
        missingEvents: 1,
      });
      expect(result.observedTotals.coverage.exhaustive).toBe(false);
    });

    it("preserves measured zero and does not infer a missing total from other columns", () => {
      const result = summarizeSessionTokenUsage([
        {
          status: LLM_USAGE_STATUSES.SETTLED,
          inputTokens: 0n,
          outputTokens: 0,
          cachedInputTokens: 0,
        },
      ]);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.cachedTokens).toBe(0);
      expect(result.totalTokens).toBeNull();
      expect(result.reasoningTokens).toBeNull();
    });

    it("does not claim completeness across unavailable, retryable or unclassified rows", () => {
      for (const status of [
        LLM_USAGE_STATUSES.UNAVAILABLE,
        LLM_USAGE_STATUSES.RETRYABLE,
        undefined,
      ]) {
        const result = summarizeSessionTokenUsage([
          { status: LLM_USAGE_STATUSES.SETTLED, totalTokens: 150n },
          { status, totalTokens: 999n },
        ]);
        expect(result.totalTokens).toBeNull();
        expect(result.observedTotals.totalTokens).toBe(150);
        expect(result.observedTotals.coverage.settledEvents).toBe(1);
      }
    });

    it("rejects unsafe/negative values and overflowing numeric totals", () => {
      for (const invalid of [-1, Number.NaN, 9007199254740992n]) {
        const result = summarizeSessionTokenUsage([
          { status: LLM_USAGE_STATUSES.SETTLED, totalTokens: invalid },
        ]);
        expect(result.totalTokens).toBeNull();
        expect(result.observedTotals.totalTokens).toBeNull();
        expect(
          result.observedTotals.coverage.metrics.totalTokens.invalidEvents,
        ).toBe(1);
      }
      const overflow = summarizeSessionTokenUsage([
        {
          status: LLM_USAGE_STATUSES.SETTLED,
          totalTokens: Number.MAX_SAFE_INTEGER,
        },
        { status: LLM_USAGE_STATUSES.SETTLED, totalTokens: 1 },
      ]);
      expect(overflow.totalTokens).toBeNull();
      expect(overflow.observedTotals.totalTokens).toBeNull();
      expect(
        overflow.observedTotals.coverage.metrics.totalTokens.overflow,
      ).toBe(true);
    });
  });

  describe("summarizeSessionTools", () => {
    const event = (
      runId: string,
      sequence: number,
      eventType: string,
      toolCallId: string | null,
    ) => ({
      runId,
      sequence,
      toolName: "agent_stream_semantic",
      outputSummaryJson: {
        agentStreamEvent: { eventType, toolCallId, toolName: "read_file" },
      },
    });

    it("counts call/result/replay rows once per run and semantic identity", () => {
      const result = summarizeSessionTools([
        event("r1", 1, STREAM.semanticToolCall, "call-1"),
        event("r1", 2, STREAM.semanticToolResult, "call-1"),
        event("r1", 3, STREAM.toolResult, "call-1"),
        event("r2", 1, STREAM.toolResult, "call-1"),
      ]);
      expect(result.toolCalls).toBe(2);
      expect(result.toolExecutions).toHaveLength(4);
      expect(result.toolCallCoverage.observedToolEvents).toBe(4);
      expect(result.toolCallCoverage.exhaustive).toBe(false);
      expect(result.toolExecutions[0].status).toBeNull();
    });

    it("keeps unidentified tools explicit and never counts a boundary/log as a model call", () => {
      const result = summarizeSessionTools([
        event("r1", 1, STREAM.toolResult, null),
        event("r1", 2, STREAM.boundaryStarted, null),
        event("r1", 3, STREAM.log, null),
        event("r1", 4, STREAM.modelCallStarted, null),
        event("r1", 5, STREAM.modelCallCompleted, null),
        { runId: "r1", sequence: 6, toolName: "legacy_tool" },
        { runId: "r1", sequence: 7, toolName: null },
      ]);
      expect(result.toolCalls).toBe(0);
      expect(result.toolCallCoverage.unidentifiedToolEvents).toBe(1);
      expect(result.toolCallCoverage.unclassifiedJournalRows).toBe(2);
      expect(result.modelCalls).toBeNull();
      expect(result.modelCallCoverage).toEqual({
        exhaustive: false,
        observedModelEvents: 2,
      });
    });

    it("makes missing history explicitly nonexhaustive", () => {
      const result = summarizeSessionTools([]);
      expect(result.toolCalls).toBe(0);
      expect(result.toolCallCoverage.exhaustive).toBe(false);
      expect(result.modelCalls).toBeNull();
      expect(result.toolExecutions).toHaveLength(0);
    });
  });
});
