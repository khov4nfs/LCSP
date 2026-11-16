import { describe, expect, it, jest } from "@jest/globals";
import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_CATALOG_KINDS,
  PREPARATION_CATALOG_SOURCES,
  preparationGeneratedCatalogRequestSchema,
} from "@lcsp/contracts/compliance-rule-set";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { PreparationGeneratedCatalogReadService } from "./preparation-generated-catalog-read.service.js";

const RUN_ID = "19c963ca-b5ab-41ee-902e-847ea25c8c65";
const SOURCE_VERSION_ID = "207e0eeb-f9f5-4fbf-8623-d47366c7e4c4";

function makeRequirement(id: string) {
  return {
    legalRequirementId: id,
    title: `Requirement ${id}`,
    proposition: `Persisted proposition for ${id}`,
    applicabilityConditions: [],
    qualifiers: [],
    exceptions: [],
    nonRepositoryDuty: false,
    sourceRefs: [],
    coverage: {
      state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
      nonAssessableReason: "Requires external evidence",
    },
  };
}

function makeDraft(version = 1) {
  return {
    draftVersion: version,
    draft: {
      legalRequirements: {
        "req-a": makeRequirement("req-a"),
        "req-b": makeRequirement("req-b"),
      },
      assessmentRules: {
        "rule-a": {
          assessmentRuleId: "rule-a",
          legalRequirementIds: ["req-a"],
          concept: "Evidence exists",
          criteria: [
            { criterionId: "criterion-a", legalRequirementIds: ["req-a"] },
          ],
          investigationGoals: [],
          startingNodeTypes: [],
          targetNodeTypes: [],
          edgeStrategies: [],
          graphQueries: [],
          keywords: [],
          commonApis: [],
          commonLibraries: [],
          patterns: [],
          requiredEvidence: [],
          supportingEvidence: [],
          negativeEvidence: [],
          sourceRefs: [],
        },
      },
      contextRelations: {},
    },
  };
}

function harness(
  draft: unknown,
  submitted: {
    id: string;
    preparationRunId: string;
    legalSourceVersionId: string;
    semanticGraph: {
      legalSourceVersionId: string;
      materializationId: string;
    } | null;
  } | null = null,
  models: Record<string, unknown> = {},
) {
  const tx = {
    ruleSetPreparationRun: {
      findUnique: jest.fn(() => ({
        id: RUN_ID,
        legalSourceVersionId: SOURCE_VERSION_ID,
        claimInventoryRevision: 3,
        ruleSet: submitted,
      })),
    },
    ruleSetPreparationReviewFrontier: {
      findUnique: jest.fn(() => ({
        inventoryRevision: 3,
        legalSourceVersionId: SOURCE_VERSION_ID,
        materializationId: "mat-pinned-3",
      })),
    },
    ruleSetPreparationAuthoringDraft: {
      findUnique: jest.fn(() => draft),
    },
    ...models,
  };
  const prisma = {
    $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as PrismaService;
  return { service: new PreparationGeneratedCatalogReadService(prisma), tx };
}

describe("PreparationGeneratedCatalogReadService", () => {
  it("returns a bounded draft page with canonical collection totals", async () => {
    const { service } = harness(makeDraft());
    const request = preparationGeneratedCatalogRequestSchema.parse({
      inventoryRevision: 3,
      kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
      limit: 1,
    });
    const page = await service.list(RUN_ID, request, "catalog-test");
    expect(page.source).toBe(PREPARATION_CATALOG_SOURCES.DRAFT);
    expect(page.total).toBe(2);
    expect(page.filteredTotal).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    if (page.kind !== PREPARATION_CATALOG_KINDS.REQUIREMENT) {
      throw new Error("the Requirement request returned another catalog kind");
    }
    expect(page.items[0]?.data.operativePropositions).toBeNull();
    expect(page.materializationId).toBe("mat-pinned-3");
  });

  it("keeps search pagination within the exact draft version and preserves the unfiltered total", async () => {
    const { service } = harness(makeDraft());
    const first = await service.list(
      RUN_ID,
      preparationGeneratedCatalogRequestSchema.parse({
        inventoryRevision: 3,
        kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
        limit: 1,
        search: "req-a",
      }),
      "catalog-test",
    );
    expect(first.total).toBe(2);
    expect(first.filteredTotal).toBe(1);
    expect(first.hasMore).toBe(false);

    const paged = await service.list(
      RUN_ID,
      preparationGeneratedCatalogRequestSchema.parse({
        inventoryRevision: 3,
        kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
        limit: 1,
      }),
      "catalog-test",
    );
    const next = await service.list(
      RUN_ID,
      preparationGeneratedCatalogRequestSchema.parse({
        inventoryRevision: 3,
        kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
        limit: 1,
        cursor: paged.nextCursor ?? undefined,
      }),
      "catalog-test",
    );
    expect(next.items[0]?.id).not.toBe(paged.items[0]?.id);
  });

  it("returns explicit unavailable state and rejects malformed persisted drafts", async () => {
    const unavailable = harness(null);
    const request = preparationGeneratedCatalogRequestSchema.parse({
      inventoryRevision: 3,
      kind: PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE,
    });
    const response = await unavailable.service.list(
      RUN_ID,
      request,
      "catalog-test",
    );
    expect(response.source).toBe(PREPARATION_CATALOG_SOURCES.UNAVAILABLE);
    expect(response.items).toEqual([]);

    const invalid = harness({
      draftVersion: 1,
      draft: {
        legalRequirements: { "req-a": { invalid: true } },
        assessmentRules: {},
        contextRelations: {},
      },
    });
    await expect(
      invalid.service.list(RUN_ID, request, "catalog-test"),
    ).rejects.toBeDefined();
  });

  it("reads submitted Requirements and Assessment Rule links from canonical persisted rows", async () => {
    const submitted = {
      id: "3292da82-72cf-4842-9fa3-417e254a1514",
      preparationRunId: RUN_ID,
      legalSourceVersionId: SOURCE_VERSION_ID,
      semanticGraph: {
        legalSourceVersionId: SOURCE_VERSION_ID,
        materializationId: "mat-pinned-3",
      },
    };
    const requirementRow = {
      id: "e217acb6-8ae3-45fe-b979-843e022c8614",
      legalRequirementId: "req-submitted",
      ordinal: 0,
      applicabilityMode: null,
      title: "Canonical title",
      proposition: "Canonical proposition",
      operativePropositions: null,
      semanticContext: null,
      applicabilityConditions: [],
      qualifiers: [],
      exceptions: [],
      nonRepositoryDuty: true,
      coverageState: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
      nonAssessableReason: "Requires external evidence",
      claimBindings: [],
      provenance: [],
    };
    const assessmentContract = {
      assessmentRuleId: "assessment-submitted",
      legalRequirementIds: ["req-submitted"],
      concept: "Persisted concept",
      legalIntent: "Persisted legal intent",
      applicabilityGuidance: "Persisted guidance",
      criteria: [
        {
          criterionId: "criterion-a",
          legalRequirementIds: ["req-submitted"],
          statement: "Canonical linked requirement predicate",
        },
      ],
      investigationGoals: [],
      startingNodeTypes: [],
      targetNodeTypes: [],
      edgeStrategies: [],
      graphQueries: [],
      keywords: [],
      commonApis: [],
      commonLibraries: [],
      patterns: [],
      requiredEvidence: [],
      supportingEvidence: [],
      negativeEvidence: [],
      unresolvedConditions: [],
      sourceRefs: [],
    };
    const { service } = harness(null, submitted, {
      legalRequirement: {
        count: jest.fn(() => 1),
        findMany: jest.fn(() => [requirementRow]),
      },
      assessmentRule: {
        count: jest.fn(() => 1),
        findMany: jest.fn(() => [
          {
            assessmentRuleId: "assessment-submitted",
            ordinal: 0,
            concept: "Persisted concept",
            legalIntent: "Persisted legal intent",
            applicabilityGuidance: "Persisted guidance",
            criteria: assessmentContract.criteria,
            contract: assessmentContract,
            legalRequirementLinks: [
              { legalRequirement: { legalRequirementId: "req-submitted" } },
            ],
          },
        ]),
      },
      legalDocumentChunk: { findMany: jest.fn(() => []) },
    });
    const requirement = await service.list(
      RUN_ID,
      preparationGeneratedCatalogRequestSchema.parse({
        inventoryRevision: 3,
        kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
      }),
      "catalog-test",
    );
    expect(requirement.source).toBe(PREPARATION_CATALOG_SOURCES.SUBMITTED);
    expect(requirement.kind).toBe(PREPARATION_CATALOG_KINDS.REQUIREMENT);
    if (requirement.kind === PREPARATION_CATALOG_KINDS.REQUIREMENT) {
      expect(requirement.items[0]?.data.title).toBe("Canonical title");
    }

    const rules = await service.list(
      RUN_ID,
      preparationGeneratedCatalogRequestSchema.parse({
        inventoryRevision: 3,
        kind: PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE,
      }),
      "catalog-test",
    );
    expect(rules.kind).toBe(PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE);
    if (rules.kind === PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE) {
      expect(rules.items[0]?.data.legalRequirementIds).toEqual([
        "req-submitted",
      ]);
    }
  });

  it("rejects a cursor after the persisted draft version changes", async () => {
    const initial = harness(makeDraft());
    const first = await initial.service.list(
      RUN_ID,
      preparationGeneratedCatalogRequestSchema.parse({
        inventoryRevision: 3,
        kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
        limit: 1,
      }),
      "catalog-test",
    );
    const changed = harness(makeDraft(2));
    await expect(
      changed.service.list(
        RUN_ID,
        preparationGeneratedCatalogRequestSchema.parse({
          inventoryRevision: 3,
          kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
          limit: 1,
          cursor: first.nextCursor ?? undefined,
        }),
        "catalog-test",
      ),
    ).rejects.toBeDefined();
  });
});
