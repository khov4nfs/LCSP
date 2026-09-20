import type { Session } from "../../../domain/models/auth.models.ts";

export const AUTH_SESSION_REPOSITORY = Symbol("AUTH_SESSION_REPOSITORY");

export interface SessionRepository {
  nextId(): string;
  save(session: Session, fingerprint?: string): Promise<void>;
  findById(id: string): Promise<Session | null>;
  findByFingerprint(fingerprint: string): Promise<Session | null>;
  revokeAllForUser(userId: string, now: number): Promise<void>;
}
