/**
 * Decorator to enforce explicit RBAC action permissions on controller endpoints.
 * Rationale ("Why"): ADR-028 Line 173 & Line 174 mandate that financial actions such as pricing,
 * reconciliation, and compensation require explicit action permissions; a role label alone never
 * grants financial authority.
 * Mechanism ("How"): Attaches required action strings to endpoint metadata, checked by RbacGuard
 * against the caller session's granted permissions.
 * Invariants & Constraints: Actions must use canonical SCREAMING_SNAKE_CASE from BILLING_ACTIONS.
 */

import { SetMetadata } from "@nestjs/common";

export const RBAC_ACTIONS_METADATA_KEY = "rbac:actions";

/**
 * Requires the authenticated actor to possess all specified action permissions.
 *
 * @param actions - The action permissions required to invoke this endpoint.
 * @returns A Nest class/method decorator.
 */
export const RequireActions = (
  ...actions: readonly string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, readonly string[]>(RBAC_ACTIONS_METADATA_KEY, actions);
