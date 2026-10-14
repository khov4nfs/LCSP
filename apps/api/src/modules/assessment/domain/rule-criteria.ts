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

/** Number of entries in a stored JSON list (0 when the column is not a list). */
export function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
