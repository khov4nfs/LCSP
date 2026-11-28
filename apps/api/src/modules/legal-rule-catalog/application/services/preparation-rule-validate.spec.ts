import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState } from "@prisma/client";
import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_OPERATIVE_MODALITIES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
} from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_RULE_CATALOG_ERRORS,
  preparationRuleOutputSchema,
  type PreparationRuleValidate,
  type PreparationRuleComplete,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  PreparationRuleService,
  validateSelectedOutput,
} from "./preparation-rule.service.js";
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
      contentSha256: `sha256:${"a".repeat(64)}`,
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

  // A valid development criterion must not mask a different unresolved legal proposition.
  const unresolved = {
    ...output,
    legalRequirements: [
      ...output.legalRequirements,
      {
        ...output.legalRequirements[0],
        legalRequirementId: `${input.ruleId}:unresolved-stage`,
        coverage: {
          state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
          nonAssessableReason:
            PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX +
            " stage unresolved",
        },
      },
    ],
  };
  expect(() => validateSelectedOutput(selected, unresolved, "cid")).toThrow(
    expect.objectContaining({
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
          meta: expect.objectContaining({
            issues: "output.legalRequirements.1.coverage.nonAssessableReason",
          }),
        }),
      }),
    }),
  );
  // The canonical schema trims coverage reasons; direct validation must do the same.
  const padded = {
    ...unresolved,
    legalRequirements: unresolved.legalRequirements.map((requirement) =>
      requirement.coverage.nonAssessableReason
        ? {
            ...requirement,
            coverage: {
              ...requirement.coverage,
              nonAssessableReason:
                "  " + requirement.coverage.nonAssessableReason,
            },
          }
        : requirement,
    ),
  };
  expect(() => validateSelectedOutput(selected, padded, "cid")).toThrow(
    expect.objectContaining({
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
        }),
      }),
    }),
  );

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
            issues: "output.contextRelations.0",
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
          meta: { issues: "output" },
        },
      },
    });
    expect(JSON.stringify(error)).not.toContain("private fixture");
  });
});

describe("failed legal scope lifecycle", () => {
  const sourceRef = {
    documentId: input.citations[0].documentId,
    locator: input.citations[0].locator,
    contentSha256: input.citations[0].contentSha256,
  };
  const failedOutput = preparationRuleOutputSchema.parse({
    analysis: "The source does not resolve the actor's development scope.",
    legalRequirements: [
      {
        legalRequirementId: `${input.ruleId}:unresolved`,
        title: "Unresolved actor",
        proposition: "The actor and timing require legal review.",
        operativePropositions: [
          {
            actor: "Unresolved actor",
            modality: LEGAL_OPERATIVE_MODALITIES.DUTY,
            action: "Perform the required action.",
            sourceRefs: [sourceRef],
          },
        ],
        applicabilityConditions: [],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        sourceRefs: [sourceRef],
        coverage: {
          state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
          nonAssessableReason:
            PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX +
            " actor unresolved",
        },
      },
    ],
    assessmentRules: [],
    contextRelations: [],
  });

  function fixture() {
    const now = new Date("2026-11-28T00:00:00Z");
    const result = {
      id: uuid(6),
      revision: 1,
      batchId: uuid(7),
      preparationRunId: runId,
      inputSnapshot: input,
      inputFingerprint: "a".repeat(64),
      instructionReceipt: receipt,
      createdAt: now,
      output: null as PreparationRuleComplete["output"],
      failureCode: null as string | null,
      preparationRun: {
        executionState: AgentExecutionState.RUNNING as AgentExecutionState,
        requestedBy: "admin-1",
        startedAt: now,
        completedAt: null as Date | null,
      },
    };
    const resultUpdate = jest.fn(
      (args: {
        data: { output: typeof result.output; failureCode: string | null };
      }) => {
        Object.assign(result, args.data);
      },
    );
    const runUpdate = jest.fn(
      (args: {
        data: { executionState: AgentExecutionState; completedAt: Date };
      }) => {
        Object.assign(result.preparationRun, args.data);
      },
    );
    const record = jest.fn();
    const tx = {
      $queryRaw: jest.fn(),
      preparationRule: { findUnique: jest.fn(() => ({ id: uuid(8) })) },
      preparationRuleResult: {
        findUnique: jest.fn(() => result),
        findMany: jest.fn(() => [result]),
        findFirst: jest.fn((args: { where: { preparationRun?: unknown } }) =>
          args.where.preparationRun ? null : { id: result.id },
        ),
        update: resultUpdate,
      },
      ruleSetPreparationRun: { update: runUpdate },
      preparationRuleBatch: {
        findUnique: jest.fn(() => ({
          id: result.batchId,
          selectionId: uuid(9),
          requestedBy: "admin-1",
          createdAt: now,
          selection: { scope: { mode: "ALL_MATCHING" } },
          items: [
            { ruleId: input.ruleId, resultId: result.id, skipped: false },
          ],
        })),
      },
    };
    const prisma = {
      ...tx,
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    } as unknown as PrismaService;
    const subject = new PreparationRuleService(
      prisma,
      { record } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { subject, result, resultUpdate, runUpdate, record };
  }

  it("retains the failed draft for history only and replays settlement without writes", async () => {
    const { subject, result, resultUpdate, runUpdate, record } = fixture();
    const request: PreparationRuleComplete = {
      preparationRunId: runId,
      executionState: AgentExecutionState.FAILED,
      failureCode: LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
      output: failedOutput,
    };
    await expect(subject.complete(request, "cid")).resolves.toEqual({
      resultId: result.id,
    });
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      result.id,
      "admin-1",
      "cid",
      expect.objectContaining({ failureCode: request.failureCode }),
    );
    const history = await subject.history(input.ruleId, "cid");
    expect(history.currentResultId).toBeNull();
    expect(history.latestResultId).toBe(result.id);
    expect(history.results[0]).toMatchObject({
      executionState: AgentExecutionState.FAILED,
      failureCode: request.failureCode,
      output: failedOutput,
    });
    const batch = await subject.batch(result.batchId, "cid");
    expect(batch).toMatchObject({
      failed: 1,
      prepared: 0,
      complete: true,
      items: [expect.objectContaining({ output: failedOutput })],
      ruleSet: {
        legalRequirements: [],
        assessmentRules: [],
        contextRelations: [],
      },
    });
    await expect(subject.complete(request, "retry")).resolves.toEqual({
      resultId: result.id,
    });
    expect(resultUpdate).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    await expect(
      subject.complete({ ...request, output: null }, "changed"),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.CONFLICT } },
    });
  });

  it("rejects success or a scope failure that has no ambiguity marker", async () => {
    const { subject, resultUpdate, runUpdate, record } = fixture();
    await expect(
      subject.complete(
        {
          preparationRunId: runId,
          executionState: AgentExecutionState.SUCCEEDED,
          output: failedOutput,
          failureCode: null,
        },
        "cid",
      ),
    ).rejects.toMatchObject({
      response: {
        problem: { code: LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED },
      },
    });
    await expect(
      subject.complete(
        {
          preparationRunId: runId,
          executionState: AgentExecutionState.FAILED,
          output: draft.output,
          failureCode: LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
        },
        "cid",
      ),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.RESULT_INVALID } },
    });
    expect(resultUpdate).not.toHaveBeenCalled();
    expect(runUpdate).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
