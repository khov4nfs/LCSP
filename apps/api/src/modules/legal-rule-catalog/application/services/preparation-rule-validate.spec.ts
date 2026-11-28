import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState } from "@prisma/client";
import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_OPERATIVE_MODALITIES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
} from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_RULE_CATALOG_ERRORS,
  LEGAL_RULE_VALIDATION_ISSUES,
  preparationRuleOutputSchema,
  type PreparationRuleValidate,
} from "@lcsp/contracts/legal-rule-catalog";
import { PreparationRuleService } from "./preparation-rule.service.js";
import { validateSelectedOutput } from "./selected-output-validation.js";
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
      // Read-only validation uses the pinned input and never loads or activates a rule set.
      {} as never, // LegalSourceSnapshotLoader
      {} as never, // ComplianceRuleSetActivation
    ),
  };
}

const receipt = { revision: "r", content: "instruction" };

it("accepts a repository rule for a prohibition with pinned marking scope", () => {
  const documentId = "LAW-134-2025-QH15";
  const sources = ["art-7", "art-7::cl-5", "art-11::cl-2"].map((locator) => ({
    documentId,
    locator,
    contentSha256: `sha256:${"a".repeat(64)}`,
  }));
  const [heading, prohibition, markingScope] = sources;
  const selected = {
    ...input,
    citations: [
      { ...heading, chunkId: "heading", content: "Các hành vi bị nghiêm cấm" },
      {
        ...prohibition,
        chunkId: "prohibition",
        content: "Tẩy xóa, làm sai lệch dấu bắt buộc.",
      },
      {
        ...markingScope,
        chunkId: "marking",
        content:
          "Nhà cung cấp bảo đảm dấu máy đọc trên âm thanh, hình ảnh, video do AI tạo ra.",
      },
    ],
  };
  const legalRequirementId = `${input.ruleId}:preserve-required-mark`;
  const assessmentRuleId = `${input.ruleId}:check-export-mark`;
  const title = "Giữ nguyên dấu máy đọc bắt buộc khi xuất nội dung AI";
  const output = preparationRuleOutputSchema.parse({
    analysis:
      "Kiểm tra phần cấm tẩy xóa hoặc làm sai lệch dấu trong luồng xuất nội dung.",
    legalRequirements: [
      {
        legalRequirementId,
        title,
        proposition: "Không tẩy xóa hoặc làm sai lệch dấu máy đọc bắt buộc.",
        operativePropositions: [
          {
            actor: "Nhà cung cấp trong phạm vi trách nhiệm đánh dấu",
            modality: LEGAL_OPERATIVE_MODALITIES.PROHIBITION,
            action:
              "Tẩy xóa hoặc làm sai lệch dấu máy đọc bắt buộc khi xuất nội dung thuộc phạm vi.",
            sourceRefs: [heading, prohibition],
          },
        ],
        applicabilityConditions: [
          "Âm thanh, hình ảnh hoặc video do hệ thống AI tạo ra thuộc diện phải đánh dấu máy đọc.",
        ],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        sourceRefs: [heading, prohibition],
        coverage: {
          state: LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
          nonAssessableReason: null,
        },
      },
    ],
    assessmentRules: [
      {
        assessmentRuleId,
        legalRequirementIds: [legalRequirementId],
        concept: title,
        criteria: [
          {
            criterionId: "preserve-mark",
            legalRequirementIds: [legalRequirementId],
            investigationFocus:
              "Đối chiếu dấu bắt buộc trước và sau luồng xuất nội dung.",
          },
        ],
        investigationGoals: [
          "Lần theo xử lý dấu trong luồng xuất nội dung thuộc phạm vi.",
        ],
        startingNodeTypes: [],
        targetNodeTypes: [],
        edgeStrategies: [],
        graphQueries: [],
        keywords: [],
        commonApis: [],
        commonLibraries: [],
        patterns: [],
        requiredEvidence: [
          "Mã hoặc kiểm thử cho thấy dấu được xử lý thế nào trong luồng xuất.",
        ],
        supportingEvidence: [],
        negativeEvidence: [],
        sourceRefs: [heading, prohibition],
      },
    ],
    contextRelations: [
      {
        relationId: `${input.ruleId}:marking-scope`,
        kind: LEGAL_CONTEXT_RELATION_KINDS.SCOPE,
        fromLegalRequirementId: legalRequirementId,
        toLegalRequirementId: null,
        toSourceRef: markingScope,
      },
    ],
  });

  expect(() => validateSelectedOutput(selected, output, "cid")).not.toThrow();
  expect(() =>
    validateSelectedOutput(
      { ...selected, citations: selected.citations.slice(0, 2) },
      output,
      "cid",
    ),
  ).toThrow(
    expect.objectContaining({
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: LEGAL_RULE_CATALOG_ERRORS.RESULT_INVALID,
          meta: expect.objectContaining({
            issueCode: LEGAL_RULE_VALIDATION_ISSUES.OUTPUT_INVALID,
          }),
        }),
      }),
    }),
  );
});

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
          meta: { issueCode: LEGAL_RULE_VALIDATION_ISSUES.OUTPUT_INVALID },
        },
      },
    });
    expect(JSON.stringify(error)).not.toContain("private fixture");
  });
});
