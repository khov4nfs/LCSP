import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { z } from "zod";
import { SAFE_CORRELATION_ID_PATTERN } from "./correlation-id.js";

/**
 * Rationale (Why):
 * Internal worker services (e.g. Python deepagents) send snake_case fields (`user_id`, `required_roles`),
 * while TypeScript modules may send camelCase fields (`userId`, `requiredRoles`).
 * Mechanism (How):
 * Defines a Zod schema accepting both variants with optional strings and arrays.
 * Invariants (What):
 * Prevents mass assignment while ensuring graceful compatibility across language runtimes.
 */
export const rbacPreflightSchema = z.object({
  user_id: z.string().optional(),
  userId: z.string().optional(),
  required_roles: z.array(z.unknown()).optional(),
  requiredRoles: z.array(z.unknown()).optional(),
  correlationId: z
    .string()
    .trim()
    .regex(SAFE_CORRELATION_ID_PATTERN)
    .max(128)
    .optional(),
});

export type RbacPreflightDto = z.infer<typeof rbacPreflightSchema>;

/**
 * Filters incoming role strings to recognized AuthUserRole values.
 *
 * @param value - Candidate array of role names.
 * @returns Filtered array containing only valid AuthUserRoles.
 */
export function parseRequiredRoles(value: unknown): readonly AuthUserRole[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isAuthUserRole);
}

/**
 * Type guard for AuthUserRole.
 *
 * @param value - Candidate value.
 * @returns True if value is a valid AuthUserRole.
 */
export function isAuthUserRole(value: unknown): value is AuthUserRole {
  return value === AUTH_USER_ROLES.admin || value === AUTH_USER_ROLES.customer;
}
