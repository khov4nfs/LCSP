import { EventEmitter } from "node:events";
import { describe, expect, it } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import { AzureDevOpsCliRepositoryProvider } from "./azure-devops-cli-repository.provider.js";

const executablePath =
  process.platform === "win32" ? "C:\\az.exe" : "/usr/bin/az";

describe("AzureDevOpsCliRepositoryProvider", () => {
  it("validates identity correctly via devops user show", async () => {
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
            user: {
              id: "00000000-0000-0000-0000-000000000001",
              principalName: "azuser@example.com",
              displayName: "Az User",
            },
          }),
        );
        child.emit("close", 0);
      });
      return child as never;
    }) as never;

    const lease = new CredentialLease("test-az-token", {
      internalCredentialId: "test-az-credential",
      credentialVersion: 1,
      repositoryFullName: "org/project/repo",
      expiresAt: new Date(Date.now() + 60_000),
    });

    try {
      const provider = new AzureDevOpsCliRepositoryProvider({
        executablePath,
        timeoutMs: 5_000,
        maxJsonOutputBytes: 1024,
        spawnImpl,
      });
      const identity = await provider.validateIdentity(lease);
      expect(identity.login).toBe("azuser@example.com");
      expect(identity.id).toBe("00000000-0000-0000-0000-000000000001");
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
        child.stderr.emit(
          "data",
          "TF401019: The Git repository with name or identifier does not exist",
        );
        child.emit("close", 1);
      });
      return child as never;
    }) as never;

    const lease = new CredentialLease("test-az-token", {
      internalCredentialId: "test-az-credential",
      credentialVersion: 1,
      repositoryFullName: "org/project/nonexistent",
      expiresAt: new Date(Date.now() + 60_000),
    });

    try {
      const provider = new AzureDevOpsCliRepositoryProvider({
        executablePath,
        timeoutMs: 5_000,
        maxJsonOutputBytes: 1024,
        spawnImpl,
      });
      await expect(
        provider.validateRepositoryAccess(lease, "org/project/nonexistent"),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      });
    } finally {
      lease.dispose();
    }
  });
});
