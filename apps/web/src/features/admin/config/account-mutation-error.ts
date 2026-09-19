import { ADMIN_ACCOUNT_ERRORS as E } from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

export function accountMutationErrorKey(error: unknown): MessageKey {
  const code = error instanceof Error ? error.message : "";
  if (code === E.duplicateAccount)
    return "pages.accountLifecycle.duplicate";
  if (code === E.lastUsableAdmin || code === E.selfSuspend)
    return "pages.accountLifecycle.lastAdmin";
  if (
    [
      E.staleVersion,
      E.invalidState,
      E.idempotencyConflict,
      E.concurrentChange,
    ].some((value) => value === code)
  )
    return "pages.accountLifecycle.conflict";
  return "pages.accountLifecycle.requestFailed";
}
