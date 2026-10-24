import type { User } from "../../../domain/models/auth.models.ts";

export const AUTH_USER_REPOSITORY = Symbol("AUTH_USER_REPOSITORY");

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} already exists`);
    this.name = "DuplicateEmailError";
  }
}

export type UserProfileUpdate = Partial<
  Pick<
    User,
    | "displayName"
    | "recoveryEmail"
    | "primaryEmailAddressPolicy"
    | "backupEmailPolicy"
  >
>;

export interface UserRepository {
  nextId(): string;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByRecoveryEmail(email: string): Promise<User | null>;
  findByPrimaryEmail(email: string): Promise<User | null>;
  recordFailedLoginAttempt(
    id: string,
    expectedPasswordHash: string,
    now: number,
    limit: number,
    lockWindowMs: number,
  ): Promise<User | null>;
  clearFailedLoginsIfCredentialsCurrent(
    id: string,
    expectedPasswordHash: string,
    now: number,
  ): Promise<User | null>;
  updateProfile(id: string, changes: UserProfileUpdate): Promise<void>;
  setMfaRequired(id: string, required: boolean): Promise<boolean>;
}
