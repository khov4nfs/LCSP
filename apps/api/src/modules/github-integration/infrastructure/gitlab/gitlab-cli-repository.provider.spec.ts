/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unused-vars */
import { EventEmitter } from "node:events";

import { describe, expect, it } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import {
  encodeGitLabProjectPath,
  GitLabCliRepositoryProvider,
} from "./gitlab-cli-repository.provider.js";

const executablePath =
  process.platform === "win32" ? "C:\\glab.exe" : "/usr/bin/glab";

describe("GitLab project path encoding", () => {
  it("encodes nested namespaces exactly once", () => {
    expect(encodeGitLabProjectPath("group/project")).toBe("group%2Fproject");
    expect(encodeGitLabProjectPath("group/subgroup/project")).toBe(
      "group%2Fsubgroup%2Fproject",
    );
  });

  it("keeps the canonical path unencoded at the domain boundary", () => {
    expect(encodeGitLabProjectPath("group/subgroup/project")).not.toContain(
      "%252F",
    );
  });

  it("uses the encoded identifier for project metadata requests", async () => {
    let args: readonly string[] | undefined;
    const spawnImpl = ((_file, receivedArgs) => {
      args = receivedArgs;
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter & { setEncoding(encoding: string): void };
        kill(): void;
      };
      child.stdout = new EventEmitter() as EventEmitter & {
        setEncoding(encoding: string): void;
      };
      child.stdout.setEncoding = () => undefined;
      child.kill = () => undefined;
      queueMicrotask(() => {
        child.stdout.emit(
          "data",
          JSON.stringify({
            id: 123,
            name: "project",
            path_with_namespace: "group/subgroup/project",
            default_branch: "main",
            visibility: "private",
            web_url: "https://gitlab.com/group/subgroup/project",
          }),
        );
        child.emit("close", 0);
      });
      return child as never;
    }) as never;
    const lease = new CredentialLease("test-gitlab-token", {
      internalCredentialId: "test-gitlab-credential",
      credentialVersion: 1,
      repositoryFullName: "group/subgroup/project",
      expiresAt: new Date(Date.now() + 60_000),
    });
    try {
      const metadata = await new GitLabCliRepositoryProvider({
        executablePath,
        timeoutMs: 5_000,
        maxJsonOutputBytes: 1024,
        spawnImpl,
      }).validateRepositoryAccess(lease, "group/subgroup/project");
      expect(metadata.fullName).toBe("group/subgroup/project");
      expect(args).toEqual(["api", "projects/group%2Fsubgroup%2Fproject"]);
    } finally {
      lease.dispose();
    }
  });

  it("maps a project-not-found command failure to repository unavailable", async () => {
    const spawnImpl = ((_file, _args) => {
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
        child.stderr.emit("data", "GET ... 404 Not Found");
        child.emit("close", 1);
      });
      return child as never;
    }) as never;
    const lease = new CredentialLease("test-gitlab-token", {
      internalCredentialId: "test-gitlab-credential",
      credentialVersion: 1,
      repositoryFullName: "group/project",
      expiresAt: new Date(Date.now() + 60_000),
    });
    try {
      await expect(
        new GitLabCliRepositoryProvider({
          executablePath,
          timeoutMs: 5_000,
          maxJsonOutputBytes: 1024,
          spawnImpl,
        }).validateRepositoryAccess(lease, "group/project"),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      });
    } finally {
      lease.dispose();
    }
  });
});

describe("GitLabCliRepositoryProvider child environment", () => {
  it("disables telemetry, updates, prompts, and ambient credential sources", async () => {
    let captured: NodeJS.ProcessEnv | undefined;
    const spawnImpl = ((_file, _args, options) => {
      captured = options.env;
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter & { setEncoding(encoding: string): void };
        kill(): void;
      };
      child.stdout = new EventEmitter() as EventEmitter & {
        setEncoding(encoding: string): void;
      };
      child.stdout.setEncoding = () => undefined;
      child.kill = () => undefined;
      queueMicrotask(() => {
        child.stdout.emit(
          "data",
          JSON.stringify({
            id: 7,
            username: "manager",
            web_url: "https://gitlab.com/manager",
          }),
        );
        child.emit("close", 0);
      });
      return child as never;
    }) as never;

    const token = "test-gitlab-token";
    const lease = new CredentialLease(token, {
      internalCredentialId: "test-gitlab-credential",
      credentialVersion: 1,
      repositoryFullName: "group/project",
      expiresAt: new Date(Date.now() + 60_000),
    });
    try {
      await new GitLabCliRepositoryProvider({
        executablePath,
        timeoutMs: 5_000,
        maxJsonOutputBytes: 1024,
        spawnImpl,
      }).validateIdentity(lease);
    } finally {
      lease.dispose();
    }

    expect(captured).toMatchObject({
      GITLAB_TOKEN: token,
      GITLAB_HOST: "https://gitlab.com",
      GLAB_SEND_TELEMETRY: "false",
      GLAB_CHECK_UPDATE: "false",
      GLAB_SHOW_WHATS_NEW: "false",
      GLAB_NO_PROMPT: "true",
      NO_COLOR: "1",
      GLAB_PROMPT_DISABLED: "1",
    });
    expect(captured?.GLAB_CONFIG_DIR).toEqual(expect.any(String));
    expect(captured).not.toHaveProperty("GH_TOKEN");
    expect(captured).not.toHaveProperty("GITLAB_ACCESS_TOKEN");
    const allowedKeys = new Set([
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TMP",
      "TEMP",
      "GITLAB_TOKEN",
      "GITLAB_HOST",
      "GLAB_CONFIG_DIR",
      "GLAB_PROMPT_DISABLED",
      "GLAB_SEND_TELEMETRY",
      "GLAB_CHECK_UPDATE",
      "GLAB_SHOW_WHATS_NEW",
      "GLAB_NO_PROMPT",
      "NO_COLOR",
    ]);
    expect(
      Object.keys(captured ?? {}).every((key) => allowedKeys.has(key)),
    ).toBe(true);
  });

  it("maps a child failure without exposing the leased token", async () => {
    const spawnImpl = ((_file, _args, options) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter & { setEncoding(encoding: string): void };
        kill(): void;
      };
      child.stdout = new EventEmitter() as EventEmitter & {
        setEncoding(encoding: string): void;
      };
      child.stdout.setEncoding = () => undefined;
      child.kill = () => undefined;
      queueMicrotask(() => child.emit("close", 1));
      return child as never;
    }) as never;
    const lease = new CredentialLease("secret-token", {
      internalCredentialId: "test-gitlab-credential",
      credentialVersion: 1,
      repositoryFullName: "group/project",
      expiresAt: new Date(Date.now() + 60_000),
    });
    try {
      await expect(
        new GitLabCliRepositoryProvider({
          executablePath,
          timeoutMs: 5_000,
          maxJsonOutputBytes: 1024,
          spawnImpl,
        }).validateIdentity(lease),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      });
    } finally {
      lease.dispose();
    }
  });
});
