import { ADMIN_ACCOUNT_ERRORS as E } from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";
export function accountMutationErrorKey(error: unknown): MessageKey {
  const code = error instanceof Error ? error.message : "";
  if (code === E.duplicateAccount || code === E.duplicateInvitation)
    return "pages.accountLifecycle.duplicate";
  if (code === E.lastUsableAdmin || code === E.selfSuspend)
    return "pages.accountLifecycle.lastAdmin";
  if (
    code === E.invitationDeliveryFailed ||
    code === E.invitationDeliveryPending
  )
    return "pages.accountLifecycle.deliveryFailed";
  if (code === E.invitationUnavailable)
    return "pages.accountLifecycle.unavailable";
  if (
    [
      E.staleVersion,
      E.staleInvitation,
      E.invalidState,
      E.idempotencyConflict,
      E.concurrentChange,
    ].some((value) => value === code)
  )
    return "pages.accountLifecycle.conflict";
  return "pages.accountLifecycle.requestFailed";
}
