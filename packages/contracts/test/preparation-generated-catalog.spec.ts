import { describe, expect, it } from "@jest/globals";
import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_CATALOG_COMPLETENESS,
  PREPARATION_CATALOG_KINDS,
  PREPARATION_CATALOG_REFERENCE_STATES,
  PREPARATION_CATALOG_SOURCES,
  preparationGeneratedCatalogRequestSchema,
  preparationGeneratedCatalogResponseSchema,
} from "../src/compliance-rule-set/index.ts";

describe("Preparation Generated Catalog contracts", () => {
  it("accepts bounded collection requests and rejects invalid paging inputs", () => {
    expect(
      preparationGeneratedCatalogRequestSchema.parse({
        inventoryRevision: "4",
        kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
      }),
    ).toMatchObject({ inventoryRevision: 4, limit: 50 });
    expect(
      preparationGeneratedCatalogRequestSchema.safeParse({
        inventoryRevision: 0,
        kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
        limit: 101,
        cursor: "not a cursor",
      }).success,
    ).toBe(false);
  });

  it("validates partial draft items without inventing server-derived assessment fields", () => {
    const response = preparationGeneratedCatalogResponseSchema.parse({
      preparationRunId: "19c963ca-b5ab-41ee-902e-847ea25c8c65",
      inventoryRevision: 4,
      legalSourceVersionId: "207e0eeb-f9f5-4fbf-8623-d47366c7e4c4",
      materializationId: "mat-4",
      source: PREPARATION_CATALOG_SOURCES.DRAFT,
      completeness: PREPARATION_CATALOG_COMPLETENESS.PARTIAL,
      draftVersion: 2,
      ruleSetVersionId: null,
      lifecycleState: null,
      unavailableReason: null,
      kind: PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE,
      total: 1,
      filteredTotal: 1,
      items: [
        {
          id: "rule-a",
          ordinal: null,
          data: {
            assessmentRuleId: "rule-a",
            concept: "Review evidence",
            legalIntent: null,
            applicabilityGuidance: null,
            legalRequirementIds: ["req-a"],
            criteria: [
              {
                criterionId: "criterion-a",
                legalRequirementIds: ["req-a"],
                statement: null,
                investigationFocus: null,
              },
            ],
            investigationGoals: [],
            startingNodeTypes: [],
            targetNodeTypes: [],
            edgeStrategies: [],
            keywords: [],
            requiredEvidence: [],
            supportingEvidence: [],
            negativeEvidence: [],
            unresolvedConditions: [],
            sourceReferences: [],
            sourceReferencesState:
              PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    expect(response.source).toBe(PREPARATION_CATALOG_SOURCES.DRAFT);
    expect(response.items[0]?.data.legalIntent).toBeNull();
  });

  it("keeps canonical Requirement coverage and unavailable state distinct", () => {
    const parsed = preparationGeneratedCatalogResponseSchema.safeParse({
      preparationRunId: "19c963ca-b5ab-41ee-902e-847ea25c8c65",
      inventoryRevision: 4,
      legalSourceVersionId: "207e0eeb-f9f5-4fbf-8623-d47366c7e4c4",
      materializationId: "mat-4",
      source: PREPARATION_CATALOG_SOURCES.DRAFT,
      completeness: PREPARATION_CATALOG_COMPLETENESS.PARTIAL,
      draftVersion: 1,
      ruleSetVersionId: null,
      lifecycleState: null,
      unavailableReason: null,
      kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
      total: 1,
      filteredTotal: 1,
      items: [
        {
          id: "req-a",
          ordinal: null,
          data: {
            legalRequirementId: "req-a",
            title: "A duty",
            proposition: "A persisted statement.",
            operativePropositions: null,
            applicabilityConditions: [],
            qualifiers: [],
            exceptions: [],
            nonRepositoryDuty: true,
            coverage: {
              state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
              nonAssessableReason: "Requires external evidence",
            },
            claimBindings: [],
            claimBindingsState:
              PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
            sourceReferences: [],
            sourceReferencesState:
              PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.items[0]?.data.coverage.state).toBe(
      LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
    );
  });
});
