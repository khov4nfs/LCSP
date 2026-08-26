import { randomUUID } from "node:crypto";

import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  AUTH_USER_ROLES,
  type AuthBackupEmailPolicy,
  type AuthPrimaryEmailAddressPolicy,
  type AuthUserRole,
} from "@lcsp/contracts/auth";

import { EmailAddress } from "../value-objects/email-address.value-object.ts";

type UserInput = {
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  failedLoginCount?: number;
  lockUntil?: number | null;
  displayName?: string | null;
  recoveryEmail?: string | null;
  primaryEmailAddressPolicy?: AuthPrimaryEmailAddressPolicy;
  backupEmailPolicy?: AuthBackupEmailPolicy;
  role?: AuthUserRole;
  mfaRequired?: boolean;
};

export class User {
  readonly id: string;
  readonly email: EmailAddress;
  passwordHash: string;
  emailVerified: boolean;
  failedLoginCount: number;
  lockUntil: number | null;
  displayName: string | null;
  recoveryEmail: string | null;
  primaryEmailAddressPolicy: AuthPrimaryEmailAddressPolicy;
  backupEmailPolicy: AuthBackupEmailPolicy;
  role: AuthUserRole;
  mfaRequired: boolean;

  constructor(input: UserInput) {
    this.id = randomUUID();
    this.email = EmailAddress.create(input.email);
    this.passwordHash = input.passwordHash;
    this.emailVerified = input.emailVerified;
    this.failedLoginCount = input.failedLoginCount ?? 0;
    this.lockUntil = input.lockUntil ?? null;
    this.displayName = input.displayName ?? null;
    this.recoveryEmail = input.recoveryEmail ?? null;
    this.primaryEmailAddressPolicy =
      input.primaryEmailAddressPolicy ??
      AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.accountEmail;
    this.backupEmailPolicy =
      input.backupEmailPolicy ?? AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail;
    this.role = input.role ?? AUTH_USER_ROLES.customer;
    this.mfaRequired = input.mfaRequired ?? false;
  }

  static rehydrate(input: UserInput & { id: string }): User {
    const entity = new User(input);
    Object.assign(entity, { id: input.id });
    return entity;
  }

  isLocked(now: number): boolean {
    return this.lockUntil !== null && this.lockUntil > now;
  }

  recordFailedLogin(
    now: number,
    failedLoginLimit: number,
    lockWindowMs: number,
  ): void {
    if (this.lockUntil !== null && this.lockUntil <= now) {
      this.failedLoginCount = 0;
      this.lockUntil = null;
    }

    this.failedLoginCount += 1;

    if (this.failedLoginCount >= failedLoginLimit) {
      this.lockUntil = now + lockWindowMs;
    }
  }

  clearFailedLogins(): void {
    this.failedLoginCount = 0;
    this.lockUntil = null;
  }

  primaryEmailAddress(): string {
    if (
      this.primaryEmailAddressPolicy ===
        AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail &&
      this.recoveryEmail
    ) {
      return this.recoveryEmail;
    }

    return this.email.toString();
  }
}
