import { inspect } from "node:util";

import { describe, expect, it } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import { CredentialLease } from "./credential-lease.js";

const SECRET = "recognizable-test-credential-lease-secret";

function lease(expiresAt = new Date(Date.now() + 60_000)) {
  return new CredentialLease(SECRET, {
    internalCredentialId: "credential-internal-1",
    credentialVersion: 3,
    repositoryFullName: "acme/repository",
    expiresAt,
  });
}

describe("CredentialLease", () => {
  it("redacts string and Node inspection representations", () => {
    const credential = lease();

    expect(String(credential)).toBe("[CredentialLease redacted]");
    expect(inspect(credential)).toBe("[CredentialLease redacted]");
    expect(String(credential)).not.toContain(SECRET);
    expect(inspect(credential)).not.toContain(SECRET);
  });

  it("refuses JSON serialization without exposing the secret", () => {
    let failure: unknown;
    try {
      JSON.stringify(lease());
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("credential_lease_not_serializable");
    expect(String(failure)).not.toContain(SECRET);
  });

  it("exposes the secret only through the explicit callback", () => {
    const credential = lease();

    expect(credential.withSecret((secret) => secret.length)).toBe(
      SECRET.length,
    );
    expect(Object.keys(credential)).not.toContain("secret");
    expect(Reflect.ownKeys(credential)).not.toContain("secret");
  });

  it("fails safely after disposal", () => {
    const credential = lease();
    credential.dispose();

    expect(() => credential.withSecret((secret) => secret)).toThrow(
      GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired,
    );
    expect(() => credential.withSecret((secret) => secret)).not.toThrow(SECRET);
  });

  it("fails safely after expiry", () => {
    const credential = lease(new Date(Date.now() - 1));

    expect(() => credential.withSecret((secret) => secret)).toThrow(
      GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired,
    );
  });
});
