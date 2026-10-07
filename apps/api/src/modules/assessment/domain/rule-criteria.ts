/** Criterion identifiers declared by an EngineeringRule's stored criteria. */
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
