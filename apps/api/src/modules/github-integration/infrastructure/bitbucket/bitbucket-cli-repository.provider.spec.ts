import { EventEmitter } from "node:events";
import { describe, expect, it } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import { BitbucketCliRepositoryProvider } from "./bitbucket-cli-repository.provider.js";

const executablePath =
  process.platform === "win32" ? "C:\\bb.exe" : "/usr/bin/bb";

describe("BitbucketCliRepositoryProvider", () => {
  it("validates identity correctly via API", async () => {
    const spawnImpl = (() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter & { setEncoding(encoding: string): void };
        stderr: EventEmitter & { setEncoding(encoding: string): void };
        kill(): void;
      };
      child.stdout = new EventEmitter() as EventEmitter & {
        setEncoding(encoding: string): void;
      };
      child.stderr = new EventEmitter() as EventEmitter & {
        setEncoding(encoding: string): void;
      };
      child.stdout.setEncoding = () => undefined;
      child.stderr.setEncoding = () => undefined;
      child.kill = () => undefined;
      queueMicrotask(() => {
        child.stdout.emit(
          "data",
          JSON.stringify({
            uuid: "{12345678-1234-1234-1234-123456789abc}",
            username: "bbuser",
            display_name: "Bitbucket User",
          }),
        );
        child.emit("close", 0);
      });
      return child as never;
    }) as never;

    const lease = new CredentialLease("test-bb-token", {
      internalCredentialId: "test-bb-credential",
      credentialVersion: 1,
      repositoryFullName: "workspace/repo",
      expiresAt: new Date(Date.now() + 60_000),
    });

    try {
      const provider = new BitbucketCliRepositoryProvider({
        executablePath,
        timeoutMs: 5_000,
        maxJsonOutputBytes: 1024,
        spawnImpl,
      });
      const identity = await provider.validateIdentity(lease);
      expect(identity.login).toBe("bbuser");
      expect(identity.id).toBe("{12345678-1234-1234-1234-123456789abc}");
    } finally {
      lease.dispose();
    }
  });

  it("handles repository not found errors gracefully", async () => {
    const spawnImpl = (() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter & { setEncoding(encoding: string): void };
        stderr: EventEmitter & { setEncoding(encoding: string): void };
        kill(): void;
      };
      child.stdout = new EventEmitter() as EventEmitter & {
        setEncoding(encoding: string): void;
      };
      child.stderr = new EventEmitter() as EventEmitter & {
        setEncoding(encoding: string): void;
      };
      child.stdout.setEncoding = () => undefined;
      child.stderr.setEncoding = () => undefined;
      child.kill = () => undefined;
      queueMicrotask(() => {
        child.stderr.emit("data", "Error: 404 Not Found");
        child.emit("close", 1);
      });
      return child as never;
    }) as never;

    const lease = new CredentialLease("test-bb-token", {
      internalCredentialId: "test-bb-credential",
      credentialVersion: 1,
      repositoryFullName: "workspace/nonexistent",
      expiresAt: new Date(Date.now() + 60_000),
    });

    try {
      const provider = new BitbucketCliRepositoryProvider({
        executablePath,
        timeoutMs: 5_000,
        maxJsonOutputBytes: 1024,
        spawnImpl,
      });
      await expect(
        provider.validateRepositoryAccess(lease, "workspace/nonexistent"),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      });
    } finally {
      lease.dispose();
    }
  });
});
