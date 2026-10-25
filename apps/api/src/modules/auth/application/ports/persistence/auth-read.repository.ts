import type { AuthUserRole } from "@lcsp/contracts/auth";

import type {
  AuthProfileSuccess,
  AuthSessionsSuccess,
} from "../../contracts/auth/settings.contract.ts";

/**
 * Read-side persistence port for authentication. Database record projection
 * belongs to the adapter; CQRS handlers retain authorization/policy decisions.
 */
export const AUTH_READ_REPOSITORY = Symbol("AUTH_READ_REPOSITORY");

export interface AuthReadRepository {
  getProfile(
    userId: string,
    sessionId: string,
    role: AuthUserRole,
  ): Promise<AuthProfileSuccess | null>;

  listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<AuthSessionsSuccess>;

  sessionSensitiveActionVerifiedAt(sessionId: string): Promise<Date | null>;
}
