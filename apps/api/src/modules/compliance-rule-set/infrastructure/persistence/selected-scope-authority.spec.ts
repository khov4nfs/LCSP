import { describe, expect, it } from "@jest/globals";
import {
  preparationRuleOutputSchema,
  type PreparationRuleInput,
  type SelectedScopeDecision,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  LEGAL_REQUIREMENT_COVERAGE_STATES as coverage,
  LEGAL_OPERATIVE_MODALITIES as modality,
} from "@lcsp/contracts/compliance-rule-set";
import { sha256Hex } from "../../../assessment/domain/domain-ids.js";
import {
  selectedScopeKey,
  validateSelectedScopeDecisions,
} from "./selected-scope-authority.js";

const content =
  "Synthetic legal source: development obligation and external filing obligation.";
const ref = {
  documentId: "test-only",
  locator: "art-1::cl-1",
  contentSha256: `sha256:${sha256Hex(content)}`,
};
const uuid = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const input: PreparationRuleInput = {
  ruleId: uuid(1),
  legalRuleId: "test",
  title: "Test",
  description: "Synthetic",
  catalogVersionId: uuid(2),
  catalogVersion: "1",
  catalogRevision: 1,
  legalSourceVersionId: uuid(3),
  sourceVersion: "1",
  indexId: uuid(4),
  indexContentHash: "sha256:index",
  citations: [{ ...ref, chunkId: "chunk-1", content }],
};
function fixture() {
  const requirement = (suffix: string, external: boolean) => ({
    legalRequirementId: `${input.ruleId}:${suffix}`,
    title: suffix,
    proposition: suffix,
    operativePropositions: [
      {
        actor: external ? "Operator" : "Developer",
        modality: modality.DUTY,
        action: suffix,
        sourceRefs: [ref],
      },
    ],
    applicabilityConditions: ["Synthetic trigger"],
    qualifiers: [],
    exceptions: [],
    nonRepositoryDuty: external,
    sourceRefs: [ref],
    coverage: {
      state: external
        ? coverage.NON_ASSESSABLE
        : coverage.COVERED_BY_ASSESSMENT_RULES,
      nonAssessableReason: external
        ? "OUT_OF_SCOPE_TARGET: external filing only"
        : null,
    },
  });
  const dev = requirement("design-protection", false),
    ops = requirement("file-report", true);
  const output = preparationRuleOutputSchema.parse({
    analysis: "Synthetic fixture",
    legalRequirements: [dev, ops],
    contextRelations: [],
    assessmentRules: [
      {
        assessmentRuleId: `${input.ruleId}:rule`,
        concept: "Test",
        legalRequirementIds: [dev.legalRequirementId],
        criteria: [
          {
            criterionId: "criterion",
            legalRequirementIds: [dev.legalRequirementId],
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
        sourceRefs: [ref],
      },
    ],
  });
  const decisions: SelectedScopeDecision[] = [dev, ops].map((r, i) => ({
    legalRequirementId: r.legalRequirementId,
    stage: i ? "NON_DEVELOPMENT" : "DEVELOPMENT",
    rationale: "Synthetic test only, not a legal finding",
    technicalDeliverable: i ? null : "Design protective control",
    sourceSupport: [
      {
        chunkId: "chunk-1",
        startOffset: 0,
        endOffset: content.length,
        contentSha256: sha256Hex(content),
      },
    ],
  }));
  return { output, decisions };
}
describe("Reusable selected semantic scope evidence", () => {
  it("authorizes an exact reviewed development requirement while accounting the external obligation", () => {
    const { output, decisions } = fixture();
    expect(
      validateSelectedScopeDecisions(input, output, decisions, "cid"),
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(
      selectedScopeKey(input, {
        ...output,
        analysis: "Different investigation notes",
      }),
    ).toBe(selectedScopeKey(input, output));
    expect(selectedScopeKey({ ...input, catalogRevision: 2 }, output)).toBe(
      selectedScopeKey(input, output),
    );
    expect(
      selectedScopeKey({ ...input, legalSourceVersionId: uuid(5) }, output),
    ).not.toBe(selectedScopeKey(input, output));
  });
  it("rejects unsupported, forged, omitted, ambiguous, and mixed normative evidence", () => {
    const { output, decisions } = fixture();
    expect(() =>
      validateSelectedScopeDecisions(
        input,
        output,
        decisions.slice(0, 1),
        "cid",
      ),
    ).toThrow();
    expect(() =>
      validateSelectedScopeDecisions(
        input,
        output,
        [{ ...decisions[0], stage: "LEGAL_REVIEW_REQUIRED" }, decisions[1]],
        "cid",
      ),
    ).toThrow();
    expect(() =>
      validateSelectedScopeDecisions(
        input,
        output,
        [
          {
            ...decisions[0],
            sourceSupport: [
              {
                ...decisions[0].sourceSupport[0],
                contentSha256: "f".repeat(64),
              },
            ],
          },
          decisions[1],
        ],
        "cid",
      ),
    ).toThrow();
    expect(() =>
      validateSelectedScopeDecisions(
        input,
        output,
        [
          decisions[0],
          {
            ...decisions[1],
            stage: "DEVELOPMENT",
            technicalDeliverable: "Fake control",
          },
        ],
        "cid",
      ),
    ).toThrow();
    const mixed = structuredClone(output);
    mixed.legalRequirements[0].operativePropositions!.push(
      output.legalRequirements[1].operativePropositions![0],
    );
    expect(() =>
      validateSelectedScopeDecisions(input, mixed, decisions, "cid"),
    ).toThrow();
  });
});
