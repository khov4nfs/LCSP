/**
 * Business purpose: Prevent candidate export retries from overwriting legal reviewer work.
 * Business rules: Only an explicitly unreviewed candidate artifact with null review fields can be regenerated. Absence of approval is not legal gold.
 * Execution flow: Check package discriminator, review state and every annotation field before allowing a replacement.
 * Failure cases: Malformed artifacts and any review annotation reject replacement; the caller retains existing bytes.
 * Side effects: None; pure validation, no approval or canonical mutation.
 */
export function assertUnreviewedLegalCandidate(value: unknown): void {
  if (!value || typeof value !== "object")
    throw Error("Malformed existing legal review artifact");
  const document = value as Record<string, unknown>;
  if (
    document.packageKind !== "UNREVIEWED_PINNED_LEGAL_RETRIEVAL_CANDIDATES" ||
    document.approvedGold !== false ||
    document.classificationPerformed !== false ||
    !Array.isArray(document.candidates)
  )
    throw Error("Existing legal review evidence must not be overwritten");
  const reviewedFields = [
    "actor",
    "action",
    "trigger",
    "lifecycleStage",
    "developerApplicability",
    "expectedDecision",
    "independentReviewerIdentity",
    "goldRevision",
    "goldHash",
  ];
  for (const item of document.candidates) {
    if (!item || typeof item !== "object")
      throw Error("Malformed existing legal review candidate");
    const row = item as Record<string, unknown>;
    if (
      row.mappingStatus !== "PENDING_INDEPENDENT_REVIEW" ||
      reviewedFields.some((field) => row[field] !== null)
    )
      throw Error("Existing legal review annotations must not be overwritten");
  }
}
