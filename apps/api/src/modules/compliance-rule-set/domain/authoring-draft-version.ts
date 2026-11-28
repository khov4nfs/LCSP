import { inventoryHash } from "./claim-inventory.js";

/**
 * Business purpose: Decide whether an authoring draft save is current, an exact replay, or stale.
 * Business rules:
 * - A save may advance only from the current stored draft version.
 * - A one-version-old request may replay only when its canonical draft content equals the saved draft.
 * Execution flow:
 * 1. Read the stored version. 2. Compare the worker's loaded version. 3. Verify exact content for a replay.
 * Failure cases:
 * - A mismatched version or payload returns stale without changing the stored draft.
 * Side effects:
 * - None; the caller decides whether to write within its transaction.
 */
export function authoringDraftSaveDecision(
  saved: { draftVersion: number; draft: unknown } | null,
  loadedVersion: number,
  candidate: unknown,
) {
  // Why: Lost-response retries must not create another draft version, while stale edits must not overwrite newer work.
  // How: Accept the current version for a write or the immediately previous version only for identical content.
  // Invariant: A content mismatch never passes as an idempotent replay.
  const currentVersion = saved?.draftVersion ?? 0;
  const replayed =
    saved !== null &&
    loadedVersion === currentVersion - 1 &&
    inventoryHash(saved.draft) === inventoryHash(candidate);
  return {
    currentVersion,
    replayed,
    stale: loadedVersion !== currentVersion && !replayed,
  };
}
