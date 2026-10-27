import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DECISION_SCOPE,
} from "@lcsp/contracts/assessment-domain";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetRuleDecisionHandler } from "./get-rule-decision.handler.js";
import { GetRuleDecisionQuery } from "./get-rule-decision.query.js";

const ASSESSMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RULE_SET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SNAPSHOT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DECISION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EVIDENCE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RULE = "RULE-1";
const COMMIT = "a".repeat(40);

function record(state: string, decisionRevision = 3) {
  return {
    decisionId: DECISION_ID,
    assessmentId: ASSESSMENT,
    ruleSetVersionId: RULE_SET,
    assessmentRuleId: RULE,
    assessmentRuleVersion: "1",
    scopeId: ASSESSMENT_DECISION_SCOPE,
    decisionRevision,
    state,
    decision: {
      assessmentRuleId: RULE,
      assessmentRuleVersion: "1",
      scopeId: ASSESSMENT_DECISION_SCOPE,
      ruleSetVersionId: RULE_SET,
      repositorySnapshotId: SNAPSHOT,
      repositoryCommit: COMMIT,
      caseRevision: 2,
      legalContextRefs: [{ legalContextId: "LC-1" }],
      applicability: "NOT_APPLICABLE",
      rationale: "The recorded condition is refuted by the cited evidence.",
      references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId: EVIDENCE }],
      criteria: [],
      compliance: null,
    },
    createdAt: new Date("2026-10-27T00:00:00.000Z"),
  };
}

function build(row: unknown) {
  const findFirst = jest.fn(() => Promise.resolve(row));
  const tx = { assessmentRuleDecision: { findFirst } };
  const authorizeInTx = jest.fn(() => Promise.resolve({}));
  const loadPins = jest.fn(() =>
    Promise.resolve({ ruleSetVersionId: RULE_SET }),
  );
  const handler = new GetRuleDecisionHandler(
    {
      $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as PrismaService,
    { authorizeInTx } as unknown as AssessmentRuntimeAuthority,
    { loadPins } as unknown as AssessmentCaseSupport,
  );
  return { handler, findFirst, authorizeInTx, loadPins, tx };
}

function query(revision?: number) {
  return new GetRuleDecisionQuery(ASSESSMENT, "lease", RULE, "corr", revision);
}

describe("GetRuleDecisionHandler", () => {
  it("returns only the latest packet for this rule in the assessment's pinned Rule Set", async () => {
    const row = record(ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED);
    const { handler, findFirst, authorizeInTx, loadPins, tx } = build(row);

    await expect(handler.execute(query())).resolves.toEqual({
      records: [
        {
          decisionId: DECISION_ID,
          assessmentId: ASSESSMENT,
          assessmentRuleId: RULE,
          scopeId: ASSESSMENT_DECISION_SCOPE,
          decisionRevision: 3,
          state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
          decision: expect.objectContaining({
            assessmentRuleId: RULE,
            ruleSetVersionId: RULE_SET,
            repositoryCommit: COMMIT,
          }),
          createdAt: "2026-10-27T00:00:00.000Z",
        },
      ],
    });
    expect(authorizeInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        assessmentId: ASSESSMENT,
        leaseToken: "lease",
        correlationId: "corr",
        requireActive: false,
      }),
    );
    expect(loadPins).toHaveBeenCalledWith(tx, ASSESSMENT, "corr");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: ASSESSMENT,
          ruleSetVersionId: RULE_SET,
          assessmentRuleId: RULE,
          scopeId: ASSESSMENT_DECISION_SCOPE,
        },
        orderBy: { decisionRevision: "desc" },
      }),
    );
  });

  it.each([
    ASSESSMENT_DECISION_RECORD_STATES.SUPERSEDED,
    ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
  ])(
    "returns an exact historical %s packet without rewriting it",
    async (state) => {
      const row = record(state, 2);
      const { handler, findFirst } = build(row);

      const result = await handler.execute(query(2));

      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        decisionRevision: 2,
        state,
        decision: row.decision,
      });
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assessmentId: ASSESSMENT,
            ruleSetVersionId: RULE_SET,
            assessmentRuleId: RULE,
            scopeId: ASSESSMENT_DECISION_SCOPE,
            decisionRevision: 2,
          }),
        }),
      );
    },
  );

  it("returns an empty packet list when no decision exists for the pinned rule", async () => {
    const { handler } = build(null);

    await expect(handler.execute(query())).resolves.toEqual({ records: [] });
  });
});
