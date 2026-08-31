import { inspect } from "node:util";

import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

const CUSTOM_INSPECT = inspect.custom;
const LEASE_REDACTION = "[CredentialLease redacted]";

export type CredentialLeaseScope = {
  credentialVersion: number;
  internalCredentialId: string;
  repositoryFullName: string;
  expiresAt: Date;
};

/** A stable, secret-free failure raised when a credential lease cannot be used. */
export class CredentialLeaseError extends Error {
  readonly code = GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired;

  constructor() {
    super(GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired);
    this.name = "CredentialLeaseError";
  }
}

/**
 * Holds one authorized credential in memory for a bounded operation.
 * The secret is non-enumerable, non-serializable, explicitly accessed, and disposable.
 */
export class CredentialLease {
  readonly credentialVersion: number;
  readonly internalCredentialId: string;
  readonly repositoryFullName: string;

  #secret: Buffer | null;
  readonly #expiresAtEpochMs: number;

  constructor(secret: string, scope: CredentialLeaseScope) {
    if (!secret) {
      throw new CredentialLeaseError();
    }
    this.#secret = Buffer.from(secret, "utf8");
    this.credentialVersion = scope.credentialVersion;
    this.internalCredentialId = scope.internalCredentialId;
    this.repositoryFullName = scope.repositoryFullName;
    this.#expiresAtEpochMs = scope.expiresAt.getTime();
  }

  get expiresAt(): Date {
    return new Date(this.#expiresAtEpochMs);
  }

  /** Exposes the secret only to a synchronous infrastructure callback. */
  withSecret<T>(consumer: (secret: string) => T, now = new Date()): T {
    const secret = this.#secret;
    if (!secret || now.getTime() >= this.#expiresAtEpochMs) {
      throw new CredentialLeaseError();
    }
    return consumer(secret.toString("utf8"));
  }

  /** Clears the in-memory secret and permanently disables this lease. */
  dispose(): void {
    this.#secret?.fill(0);
    this.#secret = null;
  }

  /** Prevents accidental queue/event serialization. */
  toJSON(): never {
    throw new Error("credential_lease_not_serializable");
  }

  toString(): string {
    return LEASE_REDACTION;
  }

  [CUSTOM_INSPECT](): string {
    return LEASE_REDACTION;
  }
}
