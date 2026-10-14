import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  type LegalRequirementCoverageState,
} from "./constants.ts";

/**
 * Structural completeness of a prepared LegalRequirement: one that assessment rules cover must
 * state, in `applicabilityConditions`, whom or what the source applies it to and what triggers it.
 * The Assessment Root reads those statements to decide applicability per rule, so an empty list
 * leaves it nothing source-derived to test. This checks that the scope was declared; it never
 * judges what the scope means, which legal roles or categories exist, or whether any system is in
 * them. Those come from the pinned legal source, authored by Rule Set Preparation.
 */
export function declaresApplicabilityScope(
  coverageState: LegalRequirementCoverageState | string,
  applicabilityConditions: readonly string[],
): boolean {
  if (
    coverageState !==
    LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES
  ) {
    return true;
  }
  return applicabilityConditions.some(
    (condition) => condition.trim().length > 0,
  );
}
