// Explanatory comment (ASM-11 / ASM-RENAME-01):
// Rationale (Why): Shared error code constant for optimistic concurrency update conflicts (409 Conflict).
// Mechanism (How): Declared as immutable const object property per contract value-set typing standard.
// Invariants: Single source of truth for ASSESSMENT_CONFLICT in SCREAMING_SNAKE_CASE.
export const ASSESSMENT_ERROR_CODES = {
  invalidRequest: "INVALID_REQUEST",
  notFound: "ASSESSMENT_NOT_FOUND",
  conflict: "ASSESSMENT_CONFLICT",
  repositorySetupIncomplete: "ASSESSMENT_REPOSITORY_SETUP_INCOMPLETE",
  repositorySetupStateInvalid: "ASSESSMENT_REPOSITORY_SETUP_STATE_INVALID",
  lifecycleRevisionStale: "ASSESSMENT_LIFECYCLE_REVISION_STALE",
} as const;
