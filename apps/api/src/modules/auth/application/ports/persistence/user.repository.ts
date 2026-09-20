import type { User } from "../../../domain/models/auth.models.ts";

export const AUTH_USER_REPOSITORY = Symbol("AUTH_USER_REPOSITORY");

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} already exists`);
    this.name = "DuplicateEmailError";
  }
}

export interface UserRepository {
  nextId(): string;
  save(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByRecoveryEmail(email: string): Promise<User | null>;
  findByPrimaryEmail(email: string): Promise<User | null>;
}
