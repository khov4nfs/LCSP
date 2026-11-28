import { HttpStatus } from "@nestjs/common";
import { Prisma, AgentExecutionState as A } from "@prisma/client";
import { z } from "zod";
import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  ASSESSMENT_RULE_IMPORT_DEFAULT_ANALYSIS,
  preparationRuleOutputSchema,
  type AssessmentRuleImportItem,
  type PreparationRuleInput,
  type PreparationRuleOutput,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  declaresApplicabilityScope,
} from "@lcsp/contracts/compliance-rule-set";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { canonicalJson } from "../../../assessment/domain/domain-ids.js";
import { validateAssessmentRuleBindings } from "../../../compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";

// Why: Activation and import must validate the same persisted selected-output contract.
// How: Keep normalization, replay comparison, and structural checks in one pure module.
// Invariant: No handler can bypass source-reference and parent-binding validation.
/**
 * Business purpose: Identify the structural field that prevented a selected result from being recorded.
 * Business rules:
 * - Report only schema field paths supplied by the validation code; authored data and citation values stay private.
 * Execution flow:
 * 1. Return the catalog result rejection with the field path and request correlation.
 * Failure cases:
 * - Always rejects settlement with HTTP 422 so the worker can record a failed attempt.
 * Side effects:
 * - Throws a typed problem without changing run state.
 */
function rejectSelectedOutput(cid: string, issues: string): never {
  throw problemException(E.RESULT_INVALID, cid, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    meta: { issues },
  });
}

/**
 * Business purpose: Turn one externally authored import item into the same selected-rule output an agent would have produced.
 * Business rules:
 * - Investigation hints the import does not carry are stored empty; server-derived prose is never supplied by the author.
 * - The shared selected-output contract decides validity; the import adds no legal interpretation.
 * Execution flow:
 * 1. Fill the fixed analysis note and empty investigation hints.
 * 2. Parse through the shared output contract, which derives intent, guidance and context relations.
 * Failure cases:
 * - A contract violation is rejected as RESULT_INVALID with the item index and structural field path only; authored values are never echoed.
 * Side effects:
 * - Pure normalization; nothing is persisted.
 */
export function normalizeImportItem(
  item: AssessmentRuleImportItem,
  index: number,
  cid: string,
): PreparationRuleOutput {
  const parsed = preparationRuleOutputSchema.safeParse({
    analysis: item.analysis ?? ASSESSMENT_RULE_IMPORT_DEFAULT_ANALYSIS,
    legalRequirements: item.legalRequirements,
    contextRelations: item.contextRelations,
    assessmentRules: item.assessmentRules.map((rule) => ({
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
  });
  if (!parsed.success)
    rejectSelectedOutput(
      cid,
      `items.${index}.${parsed.error.issues[0]?.path.join(".") ?? "output"}`,
    );
  return parsed.data;
}

/**
 * Business purpose: Recognize an import that would only repeat the rule's current prepared result, so re-running an import never creates noise revisions.
 * Business rules:
 * - Only a SUCCEEDED current result built from the same pinned input and carrying exactly the same output counts as identical.
 * Execution flow:
 * 1. Compare the current result's input fingerprint and run state.
 * 2. Compare the canonical form of its stored output with the incoming output.
 * Failure cases:
 * - No current result, a different input, a non-succeeded run or different output is not identical.
 * Side effects:
 * - Pure comparison; nothing is persisted.
 */
export function isIdenticalCurrentResult(
  last: {
    inputFingerprint: string;
    output: Prisma.JsonValue | null;
    preparationRun: { executionState: A };
  },
  fingerprint: string,
  output: PreparationRuleOutput,
): boolean {
  return Boolean(
    last.inputFingerprint === fingerprint &&
    last.preparationRun.executionState === A.SUCCEEDED &&
    last.output &&
    canonicalJson(last.output) === canonicalJson(output),
  );
}

/**
 * Business purpose: Validate selected preparation structure and provenance without deciding legal applicability.
 * Business rules:
 * - References stay within pinned chunks; AssessmentRule parents must be present, assessable and uniquely identified.
 * Execution flow:
 * 1. Parse canonical downstream contracts
 * 2. Verify unique identities, source allowlist and parent links.
 * Failure cases:
 * - Invalid structure, duplicates, foreign sources or missing/non-assessable parents return RESULT_INVALID with a safe field path.
 * Side effects:
 * - Pure validation; no semantic decision, publication or model work.
 */
export function validateSelectedOutput(
  input: PreparationRuleInput,
  output: z.infer<typeof preparationRuleOutputSchema>,
  cid: string,
): void {
  const parsed = preparationRuleOutputSchema.safeParse(output);
  if (!parsed.success) rejectSelectedOutput(cid, "output");
  const requirements = new Map(
    output.legalRequirements.map((rule) => [rule.legalRequirementId, rule]),
  );
  const assessmentIds = new Set(
    output.assessmentRules.map((rule) => rule.assessmentRuleId),
  );
  const relationIds = new Set(
    output.contextRelations.map((edge) => edge.relationId),
  );
  if (requirements.size !== output.legalRequirements.length)
    rejectSelectedOutput(cid, "output.legalRequirements.legalRequirementId");
  if (assessmentIds.size !== output.assessmentRules.length)
    rejectSelectedOutput(cid, "output.assessmentRules.assessmentRuleId");
  if (relationIds.size !== output.contextRelations.length)
    rejectSelectedOutput(cid, "output.contextRelations.relationId");
  const allowed = new Set(
    input.citations.map((ref) =>
      canonicalJson([ref.documentId, ref.locator, ref.contentSha256]),
    ),
  );
  const prefix = `${input.ruleId}:`;
  for (const [index, rule] of output.legalRequirements.entries()) {
    const path = `output.legalRequirements.${index}`;
    if (!rule.legalRequirementId.startsWith(prefix))
      rejectSelectedOutput(cid, `${path}.legalRequirementId`);
    if (!rule.operativePropositions?.length)
      rejectSelectedOutput(cid, `${path}.operativePropositions`);
    if (
      !declaresApplicabilityScope(
        rule.coverage.state,
        rule.applicabilityConditions,
        rule.applicabilityMode,
      )
    )
      rejectSelectedOutput(
        cid,
        `${path}.applicabilityConditions,${path}.applicabilityMode`,
      );
    const own = new Set(rule.sourceRefs.map((ref) => canonicalJson(ref)));
    if (
      rule.operativePropositions.some((proposition) =>
        proposition.sourceRefs.some((ref) => !own.has(canonicalJson(ref))),
      )
    )
      rejectSelectedOutput(cid, `${path}.operativePropositions.sourceRefs`);
  }
  for (const collection of ["legalRequirements", "assessmentRules"] as const) {
    for (const [index, rule] of output[collection].entries()) {
      if (
        !rule.sourceRefs.length ||
        rule.sourceRefs.some(
          (ref) =>
            !allowed.has(
              canonicalJson([ref.documentId, ref.locator, ref.contentSha256]),
            ),
        )
      )
        rejectSelectedOutput(cid, `output.${collection}.${index}.sourceRefs`);
    }
  }
  for (const [index, edge] of output.contextRelations.entries()) {
    if (
      !edge.relationId.startsWith(prefix) ||
      !requirements.has(edge.fromLegalRequirementId) ||
      (edge.toLegalRequirementId &&
        !requirements.has(edge.toLegalRequirementId)) ||
      (edge.toSourceRef &&
        !allowed.has(
          canonicalJson([
            edge.toSourceRef.documentId,
            edge.toSourceRef.locator,
            edge.toSourceRef.contentSha256,
          ]),
        ))
    )
      rejectSelectedOutput(cid, `output.contextRelations.${index}`);
  }
  for (const [index, rule] of output.assessmentRules.entries()) {
    const path = `output.assessmentRules.${index}`;
    if (!rule.assessmentRuleId.startsWith(prefix))
      rejectSelectedOutput(cid, `${path}.assessmentRuleId`);
    if (
      rule.legalRequirementIds.some(
        (id) =>
          !requirements.has(id) ||
          requirements.get(id)!.coverage.state ===
            LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
      )
    )
      rejectSelectedOutput(cid, `${path}.legalRequirementIds`);
  }
  if (validateAssessmentRuleBindings(output).length)
    rejectSelectedOutput(cid, "output.assessmentRules");
}
