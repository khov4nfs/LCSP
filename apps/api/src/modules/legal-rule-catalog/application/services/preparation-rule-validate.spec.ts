import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState } from "@prisma/client";
import {
  LEGAL_RULE_CATALOG_ERRORS,
  type PreparationRuleValidate,
} from "@lcsp/contracts/legal-rule-catalog";
import { PreparationRuleService } from "./preparation-rule.service.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

const uuid = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const runId = uuid(1);
const input = {
  ruleId: uuid(2),
  legalRuleId: "rule-1",
  title: "Selected rule",
  description: "Selected rule description",
  catalogVersionId: uuid(3),
  catalogVersion: "v1",
  catalogRevision: 1,
  legalSourceVersionId: uuid(4),
  sourceVersion: "v1",
  indexId: uuid(5),
  indexContentHash: "sha256:index",
  citations: [
    {
      chunkId: "chunk-1",
      documentId: "doc-1",
      locator: "art-1::cl-1",
      contentSha256: "sha256:chunk",
      content: "Legal text",
    },
  ],
};
const draft = {
  preparationRunId: runId,
  output: {
    analysis: "No developer duty is supported by the pinned source.",
    legalRequirements: [],
    assessmentRules: [],
    contextRelations: [],
  },
} as unknown as PreparationRuleValidate;

function service(
  result: {
    executionState: AgentExecutionState;
    receipt: unknown;
  } | null,
) {
  const findUnique = jest.fn<(args: unknown) => Promise<unknown>>();
  findUnique.mockResolvedValue(
    result && {
      id: uuid(6),
      inputSnapshot: input,
      instructionReceipt: result.receipt,
      preparationRun: { executionState: result.executionState },
    },
  );
  const prisma = {
    preparationRuleResult: { findUnique },
  } as unknown as PrismaService;
  const write = jest.fn();
  return {
    findUnique,
    write,
    subject: new PreparationRuleService(
      prisma,
      {} as never,
      { enqueue: write } as never,
      { execute: write } as never,
    ),
  };
}

const receipt = { revision: "r", content: "instruction" };

describe("PreparationRuleService.validate", () => {
  it("accepts a structurally valid empty result without writing anything", async () => {
    const { subject, write } = service({
      executionState: AgentExecutionState.RUNNING,
      receipt,
    });
    await expect(subject.validate(draft, "cid")).resolves.toEqual({
      valid: true,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects a run that is not RUNNING or has no instruction receipt", async () => {
    for (const state of [
      { executionState: AgentExecutionState.SUCCEEDED, receipt },
      { executionState: AgentExecutionState.RUNNING, receipt: null },
    ])
      await expect(
        service(state).subject.validate(draft, "cid"),
      ).rejects.toMatchObject({
        response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.CONFLICT } },
      });
  });

  it("reports an unknown run as not found", async () => {
    await expect(
      service(null).subject.validate(draft, "cid"),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.NOT_FOUND } },
    });
  });

  it("rejects an invalid draft with a safe field path only", async () => {
    const invalid = {
      ...draft,
      output: { ...draft.output, analysis: { text: "private fixture" } },
    } as unknown as PreparationRuleValidate;
    const error = await service({
      executionState: AgentExecutionState.RUNNING,
      receipt,
    })
      .subject.validate(invalid, "cid")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      response: {
        problem: {
          code: LEGAL_RULE_CATALOG_ERRORS.RESULT_INVALID,
          status: 422,
          meta: { issues: "output" },
        },
      },
    });
    expect(JSON.stringify(error)).not.toContain("private fixture");
  });
});
