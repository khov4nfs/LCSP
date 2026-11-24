import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";

/**
 * Query for retrieving the authenticated user's privacy settings.
 *
 * Rationale (Why):
 * CQRS query object representing the intent to read user privacy preferences.
 *
 * Mechanism (How):
 * Carries the authenticated RBAC request context and optional correlation ID.
 *
 * Invariants (What):
 * Bound strictly to the caller's authenticated session context.
 */
export class GetPrivacySettingsQuery {
  constructor(
    public readonly context: RbacRequestContext,
    public readonly correlationId?: string,
  ) {}
}
