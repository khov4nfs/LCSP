import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_PIPELINE_CONTINUE_ACTIONS,
  ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES,
} from "@lcsp/contracts/evidence";

import { pipelineContinueMessageKey } from "../src/features/workspace/config/pipeline-continue.ts";
import { continueAssessmentPipeline } from "../src/lib/api/assessment-interview-client.ts";
import { API_OUTCOME_KINDS } from "../src/lib/api/outcome-kinds.ts";

async function withFetch<T>(
  response: Response,
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return response.clone();
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function problem(code: string, status: number): Response {
  return Response.json(
    { ok: false, problem: { code, status, requiredAction: "none" } },
    { status },
  );
}

test("continue posts to the pipeline BFF and reports which step restarted", async () => {
  await withFetch(
    Response.json({
      ok: true,
      data: { action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.downstreamRequeued },
    }),
    async (calls) => {
      const outcome = await continueAssessmentPipeline("asm 1");
      assert.deepEqual(calls, ["/api/assessments/asm%201/pipeline/continue"]);
      assert.deepEqual(outcome, {
        kind: API_OUTCOME_KINDS.requested,
        action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.downstreamRequeued,
      });
      assert.equal(
        pipelineContinueMessageKey(outcome),
        "pages.assessmentFlow.pipeline.continueQueued",
      );
    },
  );
});

test("continue maps every refusal to a specific customer message", async () => {
  const cases = [
    [
      problem(ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.alreadyRunning, 409),
      API_OUTCOME_KINDS.alreadyRunning,
      "pages.assessmentFlow.pipeline.continueAlreadyRunning",
    ],
    [
      problem(
        ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.waitingForCustomer,
        409,
      ),
      API_OUTCOME_KINDS.waitingForCustomer,
      "pages.assessmentFlow.pipeline.continueWaitingForCustomer",
    ],
    [
      problem(ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.completed, 409),
      API_OUTCOME_KINDS.completed,
      "pages.assessmentFlow.pipeline.continueCompleted",
    ],
    [
      // Model usage no longer debits the wallet: a 402 is just an unexpected failure.
      problem("BILLING_INSUFFICIENT_CREDITS", 402),
      API_OUTCOME_KINDS.error,
      "pages.assessmentFlow.pipeline.continueFailed",
    ],
    [
      problem("SOMETHING_UNEXPECTED", 500),
      API_OUTCOME_KINDS.error,
      "pages.assessmentFlow.pipeline.continueFailed",
    ],
  ] as const;

  for (const [response, kind, messageKey] of cases) {
    await withFetch(response, async () => {
      const outcome = await continueAssessmentPipeline("asm-1");
      assert.equal(outcome.kind, kind);
      assert.equal(pipelineContinueMessageKey(outcome), messageKey);
    });
  }
});

test("Outcome kinds have no insufficient-credits path", () => {
  assert.equal("insufficientCredits" in API_OUTCOME_KINDS, false);
});
