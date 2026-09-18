import type { Session } from "../../../domain/models/auth-workspace.models.ts";

export const AUTH_WORKSPACE_SESSION_REPOSITORY = Symbol(
  "AUTH_WORKSPACE_SESSION_REPOSITORY",
);

export interface SessionRepository {
  nextId(): string;
  save(session: Session, fingerprint?: string): Promise<void>;
  findById(id: string): Promise<Session | null>;
  findByFingerprint(fingerprint: string): Promise<Session | null>;
  /** Revokes every active (non-expired, non-revoked) session for a user — used after a password reset. */
  revokeAllForUser(userId: string, now: number): Promise<void>;
}
