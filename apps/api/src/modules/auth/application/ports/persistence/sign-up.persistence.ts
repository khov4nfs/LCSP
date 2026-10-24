import type { Session, User } from "../../../domain/models/auth.models.ts";

export const AUTH_SIGN_UP_PERSISTENCE = Symbol("AUTH_SIGN_UP_PERSISTENCE");

export type CreateSignUpRecords = {
  user: User;
  session: Session;
  tokenFingerprint: string;
  correlationId: string;
};

/** Coordinates atomic sign-up persistence without exposing Prisma to the handler. */
export interface SignUpPersistence {
  emailExists(email: string): Promise<boolean>;
  createWithSessionAndAudit(input: CreateSignUpRecords): Promise<void>;
}
