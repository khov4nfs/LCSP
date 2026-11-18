import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import type {
  AccountSecurityProps,
  SecurityChallengeOutcome,
} from "../types/account-security.types";

/**
 * Business purpose: Complete an account security action after the backend's required proofs.
 * Business rules:
 * - OTP and password challenges are separate proofs, each attempted at most once.
 * - Cancellation and repeated challenges never authorize another write.
 * Execution flow:
 * 1. Submit the requested action and identify any backend challenge.
 * 2. Obtain the requested proof and retry only a rejected request, up to two distinct challenges.
 * 3. Return the final outcome, or null when the user cancels.
 * Failure cases:
 * - Transport errors propagate without retry because a write may already have committed.
 * - Repeated challenges return to the caller as unresolved failures.
 * Side effects:
 * - Calls the supplied mutation and may open the shared Settings verification dialog.
 */
export async function runAccountSecurityAction<
  T extends SecurityChallengeOutcome,
>(
  action: () => Promise<T>,
  onReauthenticate: AccountSecurityProps["onReauthenticate"],
): Promise<T | null> {
  const attempted = new Set<T["kind"]>();
  let outcome = await action();
  while (
    outcome.kind === API_OUTCOME_KINDS.mfaRequired ||
    outcome.kind === API_OUTCOME_KINDS.reauthRequired
  ) {
    if (attempted.has(outcome.kind)) return outcome;
    attempted.add(outcome.kind);
    if (
      !(await onReauthenticate(outcome.kind === API_OUTCOME_KINDS.mfaRequired))
    )
      return null;
    outcome = await action();
  }
  return outcome;
}
