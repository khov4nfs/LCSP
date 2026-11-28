import type { AuthUserRole } from "@lcsp/contracts/auth";

/**
 * RBAC context representing the authenticated caller's identity, role, scope, and granted action permissions.
 * Rationale ("Why"): ADR-028 Line 173-174 requires explicit action permission verification beyond pure role labels.
 * Mechanism ("How"): Guard populates permissions from session metadata or default role capabilities.
 * Invariants & Constraints: Immutable across the request lifetime; role and permissions are server-derived.
 */
export interface RbacRequestContext {
  userId: string;
  sessionId: string;
  role: AuthUserRole;
  scope: string | null;
  permissions?: readonly string[];
}
