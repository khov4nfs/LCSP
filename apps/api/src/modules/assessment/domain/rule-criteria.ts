/** Criterion identifiers declared by an AssessmentRule's stored criteria. */
export function criterionIdsOf(criteria: unknown): string[] {
  return Array.isArray(criteria)
    ? criteria.flatMap((item) =>
        item &&
        typeof item === "object" &&
        typeof (item as { criterionId?: unknown }).criterionId === "string"
          ? [(item as { criterionId: string }).criterionId]
          : [],
      )
    : [];
}

/**
 * Business purpose: Provide the declared applicability-element count used to validate a
 *   decision’s element indices.
 *
 * Business rules:
 * - Count entries only when the stored JSON value is an array; do not interpret or validate
 *   the legal meaning of its members.
 *
 * Execution flow:
 * 1. Return the array length, or zero for another JSON shape.
 *
 * Failure cases:
 * - Non-array and absent values yield zero rather than inventing declared elements.
 *
 * Side effects:
 * - None: pure projection of the stored value.
 */
export function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
