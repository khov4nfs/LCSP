import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState } from "@prisma/client";
import {
  LEGAL_OPERATIVE_MODALITIES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
} from "@lcsp/contracts/compliance-rule-set";
import {
  ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION,
  ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS,
  LEGAL_RULE_CATALOG_ERRORS,
  LEGAL_RULE_CATALOG_EVENTS,
  assessmentRuleImportRequestSchema,
  preparationRuleOutputSchema,
  type AssessmentRuleImportRequest,
} from "@lcsp/contracts/legal-rule-catalog";
import { PreparationRuleService } from "./preparation-rule.service.js";
import { preparationInputFingerprint } from "./legal-rule-catalog.service.js";
import { canonicalJson } from "../../../assessment/domain/domain-ids.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

const uuid = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const catalogId = uuid(3);
const sourceId = uuid(4);
const ruleId = uuid(2);
const excludedRuleId = uuid(8);
const ref = {
  documentId: "LAW-134-2025-QH15",
  locator: "art-7::cl-5",
  contentSha256: `sha256:${"a".repeat(64)}`,
};
const input = {
  ruleId,
  legalRuleId: "rule-1",
  title: "Selected rule",
  description: "Selected rule description",
  catalogVersionId: catalogId,
  catalogVersion: "v1",
  catalogRevision: 3,
  legalSourceVersionId: sourceId,
  sourceVersion: "v1",
  indexId: uuid(5),
  indexContentHash: "sha256:index",
  citations: [{ ...ref, chunkId: "chunk-1", content: "Legal text" }],
};
const requirementId = `${ruleId}:preserve-mark`;
const request = (
  override: Partial<AssessmentRuleImportRequest> = {},
): AssessmentRuleImportRequest =>
  assessmentRuleImportRequestSchema.parse({
    schemaVersion: ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION,
    catalogVersionId: catalogId,
    expectedCatalogRevision: 3,
    legalSourceVersionId: sourceId,
    items: [
      {
        ruleId,
        legalRequirements: [
          {
            legalRequirementId: requirementId,
            title: "Giữ nguyên dấu máy đọc",
            proposition: "Không tẩy xóa dấu máy đọc bắt buộc.",
            operativePropositions: [
              {
                actor: "Nhà cung cấp",
                modality: LEGAL_OPERATIVE_MODALITIES.PROHIBITION,
                action: "Tẩy xóa dấu máy đọc bắt buộc khi xuất nội dung.",
                sourceRefs: [ref],
              },
            ],
            applicabilityConditions: ["Nội dung do hệ thống AI tạo ra."],
            qualifiers: [],
            exceptions: [],
            nonRepositoryDuty: false,
            sourceRefs: [ref],
            coverage: {
              state:
                LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
              nonAssessableReason: null,
            },
          },
        ],
        assessmentRules: [
          {
            assessmentRuleId: `${ruleId}:check-mark`,
            concept: "Kiểm tra dấu máy đọc",
            legalRequirementIds: [requirementId],
            criteria: [
              {
                criterionId: "check-mark",
                legalRequirementIds: [requirementId],
              },
            ],
            evidenceBindings: [{ criterionId: "check-mark", kind: "REQUIRED" }],
            requiredEvidence: ["Mã hoặc test cho thấy dấu được giữ nguyên."],
            sourceRefs: [ref],
          },
        ],
      },
    ],
    excludedItems: [],
    ...override,
  });

type Call = (...args: unknown[]) => Promise<unknown>;
const resolves = (value: unknown) => jest.fn<Call>().mockResolvedValue(value);

function setup(
  last: unknown = null,
  catalog: { legalSourceVersionId: string } = {
    legalSourceVersionId: sourceId,
  },
) {
  const tx = {
    preparationRule: {
      upsert: resolves({ id: uuid(6), legalRuleId: ruleId }),
      findUnique: resolves({ id: uuid(6), legalRuleId: ruleId }),
    },
    $queryRaw: resolves([]),
    preparationRuleResult: {
      findFirst: resolves(last),
      create: resolves({ id: uuid(7) }),
    },
    preparationRuleSelection: { create: resolves({ id: uuid(8) }) },
    preparationRuleBatch: {
      create: resolves({ id: uuid(9) }),
      update: resolves({}),
    },
    ruleSetPreparationRun: { create: resolves({ id: uuid(1) }) },
  };
  const catalogs = {
    lock: resolves(undefined),
    entries: resolves({
      catalog: { id: catalogId, revision: 3, ...catalog },
      items: [
        { id: ruleId, input },
        {
          id: excludedRuleId,
          input: {
            ...input,
            ruleId: excludedRuleId,
            legalRuleId: "excluded-rule",
          },
        },
      ],
    }),
    hydrate: jest
      .fn<(tx: unknown, inputs: unknown[]) => Promise<unknown[]>>()
      .mockImplementation((_tx, inputs) => Promise.resolve(inputs)),
    record: resolves(undefined),
  };
  const enqueue = jest.fn<Call>();
  const prisma = {
    $transaction: (callback: (client: unknown) => unknown) =>
      Promise.resolve(callback(tx)),
  } as unknown as PrismaService;
  return {
    tx,
    catalogs,
    enqueue,
    subject: new PreparationRuleService(
      prisma,
      catalogs as never,
      { enqueue } as never,
      { execute: jest.fn<Call>() } as never,
      {} as never,
      {} as never,
    ),
  };
}

describe("PreparationRuleService.importAssessmentRules", () => {
  it("records a SUCCEEDED prepared revision without dispatching any agent work", async () => {
    const { subject, tx, catalogs, enqueue } = setup();
    const result = await subject.importAssessmentRules(
      catalogId,
      request(),
      "admin-1",
      "cid",
    );
    expect(result.imported).toEqual([
      {
        ruleId,
        resultId: uuid(7),
        revision: 1,
        assessmentRuleCount: 1,
        replayed: false,
      },
    ]);
    expect(tx.ruleSetPreparationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        executionState: AgentExecutionState.SUCCEEDED,
        legalSourceVersionId: sourceId,
      }),
    });
    expect(tx.preparationRuleResult.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revision: 1,
        inputFingerprint: preparationInputFingerprint(input),
      }),
    });
    expect(catalogs.record).toHaveBeenCalledWith(
      tx,
      LEGAL_RULE_CATALOG_EVENTS.RESULT_IMPORTED,
      uuid(7),
      "admin-1",
      "cid",
      expect.objectContaining({ revision: 1 }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("acknowledges an identical current result as a replay without writing", async () => {
    const first = setup();
    await first.subject.importAssessmentRules(
      catalogId,
      request(),
      "admin-1",
      "cid",
    );
    const stored = (
      first.tx.preparationRuleResult.create.mock.calls[0][0] as {
        data: { output: unknown };
      }
    ).data.output;
    const { subject, tx } = setup({
      id: uuid(7),
      revision: 1,
      inputFingerprint: preparationInputFingerprint(input),
      output: JSON.parse(canonicalJson(stored)) as unknown,
      preparationRun: { executionState: AgentExecutionState.SUCCEEDED },
    });
    const result = await subject.importAssessmentRules(
      catalogId,
      request(),
      "admin-1",
      "cid",
    );
    expect(result.imported[0]).toMatchObject({ revision: 1, replayed: true });
    expect(tx.preparationRuleResult.create).not.toHaveBeenCalled();
    expect(tx.preparationRuleBatch.create).not.toHaveBeenCalled();
  });

  it("previews a dry run from reads alone and records nothing", async () => {
    const { subject, tx, catalogs, enqueue } = setup();
    const result = await subject.importAssessmentRules(
      catalogId,
      request({ dryRun: true }),
      "admin-1",
      "cid",
    );
    expect(result.dryRun).toBe(true);
    expect(result.imported).toEqual([
      {
        ruleId,
        resultId: null,
        revision: 1,
        assessmentRuleCount: 1,
        replayed: false,
      },
    ]);
    expect(tx.preparationRule.upsert).not.toHaveBeenCalled();
    expect(tx.preparationRuleResult.create).not.toHaveBeenCalled();
    expect(tx.preparationRuleBatch.create).not.toHaveBeenCalled();
    expect(tx.ruleSetPreparationRun.create).not.toHaveBeenCalled();
    expect(catalogs.record).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still rejects an invalid document in a dry run", async () => {
    const { subject } = setup();
    const foreign = { ...ref, contentSha256: `sha256:${"b".repeat(64)}` };
    const bad = request({ dryRun: true });
    bad.items[0].assessmentRules[0].sourceRefs = [foreign];
    await expect(
      subject.importAssessmentRules(catalogId, bad, "admin-1", "cid"),
    ).rejects.toMatchObject({
      response: {
        problem: { code: LEGAL_RULE_CATALOG_ERRORS.RESULT_INVALID },
      },
    });
  });

  it("rejects a citation that is not pinned for the rule and writes nothing", async () => {
    const { subject, tx } = setup();
    const foreign = { ...ref, contentSha256: `sha256:${"b".repeat(64)}` };
    const bad = request();
    bad.items[0].assessmentRules[0].sourceRefs = [foreign];
    const error = await subject
      .importAssessmentRules(catalogId, bad, "admin-1", "cid")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      response: {
        problem: {
          code: LEGAL_RULE_CATALOG_ERRORS.RESULT_INVALID,
          status: 422,
          meta: { issues: "output.assessmentRules.0.sourceRefs" },
        },
      },
    });
    expect(tx.preparationRuleResult.create).not.toHaveBeenCalled();
    expect(tx.ruleSetPreparationRun.create).not.toHaveBeenCalled();
  });

  it("rejects a document for another catalog, source or revision", async () => {
    await expect(
      setup().subject.importAssessmentRules(
        uuid(9),
        request(),
        "admin-1",
        "cid",
      ),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.INVALID } },
    });
    await expect(
      setup(null, {
        legalSourceVersionId: uuid(8),
      }).subject.importAssessmentRules(catalogId, request(), "admin-1", "cid"),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.STALE } },
    });
  });

  it("refuses to replace a rule whose Preparation run is still active", async () => {
    const { subject, tx } = setup({
      id: uuid(7),
      revision: 1,
      inputFingerprint: "x",
      output: null,
      preparationRun: { executionState: AgentExecutionState.RUNNING },
    });
    await expect(
      subject.importAssessmentRules(catalogId, request(), "admin-1", "cid"),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.CONFLICT } },
    });
    expect(tx.preparationRuleResult.create).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "rejects an explicitly unresolved exclusion without writing or dispatch (dryRun=%s)",
    async (dryRun) => {
      const { subject, tx, catalogs, enqueue } = setup();
      await expect(
        subject.importAssessmentRules(
          catalogId,
          request({
            dryRun,
            excludedItems: [
              {
                ruleId: excludedRuleId,
                reasonCode:
                  ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.NEEDS_REVIEW,
                reason: "Actor and regulated activity require legal review",
              },
            ],
          }),
          "admin-1",
          "cid",
        ),
      ).rejects.toMatchObject({
        response: {
          problem: {
            code: LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
            meta: { issues: "excludedItems.0.reasonCode" },
          },
        },
      });
      expect(tx.preparationRule.upsert).not.toHaveBeenCalled();
      expect(tx.preparationRuleResult.create).not.toHaveBeenCalled();
      expect(tx.ruleSetPreparationRun.create).not.toHaveBeenCalled();
      expect(catalogs.record).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "rejects a mixed result with a declared unresolved scope (dryRun=%s)",
    async (dryRun) => {
      const { subject, tx, enqueue } = setup();
      const document = request({ dryRun });
      const first = document.items[0].legalRequirements[0];
      document.items[0].legalRequirements.push({
        ...first,
        legalRequirementId: `${ruleId}:unresolved-stage`,
        coverage: {
          state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
          nonAssessableReason:
            PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX +
            " actor unresolved",
        },
      });
      await expect(
        subject.importAssessmentRules(catalogId, document, "admin-1", "cid"),
      ).rejects.toMatchObject({
        response: {
          problem: {
            code: LEGAL_RULE_CATALOG_ERRORS.SCOPE_REVIEW_REQUIRED,
            meta: {
              issues: "output.legalRequirements.1.coverage.nonAssessableReason",
            },
          },
        },
      });
      expect(tx.preparationRuleResult.create).not.toHaveBeenCalled();
      expect(tx.ruleSetPreparationRun.create).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it("records pinned exclusion evidence even without an imported result", async () => {
    const { subject, tx, catalogs, enqueue } = setup();
    const exclusion = {
      ruleId: excludedRuleId,
      reasonCode: ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.OUT_OF_SCOPE,
      reason: "Operator-only activity",
    };
    const document = request({ items: [], excludedItems: [exclusion] });
    await subject.importAssessmentRules(catalogId, document, "admin-1", "cid");
    const args = catalogs.record.mock.calls[0];
    expect(args).toEqual([
      tx,
      LEGAL_RULE_CATALOG_EVENTS.IMPORT_EXCLUSIONS_RECORDED,
      catalogId,
      "admin-1",
      "cid",
      expect.objectContaining({
        catalogRevision: 3,
        legalSourceVersionId: sourceId,
        exclusions: [
          expect.objectContaining({
            ...exclusion,
            citations: [{ ...ref, chunkId: "chunk-1" }],
          }),
        ],
        imported: [],
      }),
      expect.any(String),
    ]);
    await subject.importAssessmentRules(catalogId, document, "admin-1", "retry");
    expect(catalogs.record.mock.calls[1][6]).toBe(args[6]);
    expect(tx.preparationRuleResult.create).not.toHaveBeenCalled();
    expect(tx.ruleSetPreparationRun.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("previews exclusions without recording audit evidence", async () => {
    const { subject, catalogs, enqueue } = setup();
    await subject.importAssessmentRules(
      catalogId,
      request({
        dryRun: true,
        items: [],
        excludedItems: [
          {
            ruleId: excludedRuleId,
            reasonCode: ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.CONTEXT_ONLY,
            reason: "Context only",
          },
        ],
      }),
      "admin-1",
      "cid",
    );
    expect(catalogs.record).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a rule that is both included and excluded", async () => {
    const { subject, tx, catalogs } = setup();
    await expect(
      subject.importAssessmentRules(
        catalogId,
        request({
          excludedItems: [
            {
              ruleId,
              reasonCode: ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.OUT_OF_SCOPE,
              reason: "Contradictory declaration",
            },
          ],
        }),
        "admin-1",
        "cid",
      ),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.INVALID } },
    });
    expect(tx.preparationRuleResult.create).not.toHaveBeenCalled();
    expect(catalogs.record).not.toHaveBeenCalled();
  });

  it("rejects an excluded item that is not in the catalog", async () => {
    await expect(
      setup().subject.importAssessmentRules(
        catalogId,
        request({
          excludedItems: [
            {
              ruleId: uuid(9),
              reasonCode: ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.NON_ASSESSABLE,
              reason: "Ngoài repo",
            },
          ],
        }),
        "admin-1",
        "cid",
      ),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.INVALID } },
    });
  });
});

describe("assessmentRuleImportRequestSchema", () => {
  const base = request();
  it("stores investigation hints empty and passes through the shared output contract", () => {
    expect(
      preparationRuleOutputSchema.safeParse({
        analysis: "x",
        legalRequirements: base.items[0].legalRequirements,
        assessmentRules: base.items[0].assessmentRules.map((rule) => ({
          investigationGoals: [],
          startingNodeTypes: [],
          targetNodeTypes: [],
          edgeStrategies: [],
          graphQueries: [],
          keywords: [],
          commonApis: [],
          commonLibraries: [],
          patterns: [],
          supportingEvidence: [],
          negativeEvidence: [],
          ...rule,
        })),
        contextRelations: [],
      }).success,
    ).toBe(true);
  });

  it("rejects server-derived fields and duplicate rule ids", () => {
    const withIntent = JSON.parse(JSON.stringify(base)) as {
      items: Array<{ assessmentRules: Array<Record<string, unknown>> }>;
    };
    withIntent.items[0].assessmentRules[0].legalIntent = "supplied";
    expect(
      assessmentRuleImportRequestSchema.safeParse(withIntent).success,
    ).toBe(false);
    const duplicate = {
      ...base,
      items: [base.items[0], base.items[0]],
    };
    expect(assessmentRuleImportRequestSchema.safeParse(duplicate).success).toBe(
      false,
    );
  });
});
