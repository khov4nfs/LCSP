import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, jest } from "@jest/globals";
import {
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_CREDENTIAL_ERROR_CODES,
} from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import {
  GitHubCliRepositoryProvider,
  type GitHubCliProcessOptions,
  type GitHubCliProcessRunner,
  type GitHubCliRepositoryProviderOptions,
} from "./github-cli-repository.provider.js";

const MANAGER_A_SECRET = "recognizable-test-manager-a-secret";
const MANAGER_B_SECRET = "recognizable-test-manager-b-secret";

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = jest.fn(() => true);
}

type ObservedSpawn = {
  executable: string;
  args: readonly string[];
  options: GitHubCliProcessOptions;
};

function options(
  overrides: Partial<GitHubCliRepositoryProviderOptions> = {},
): GitHubCliRepositoryProviderOptions {
  return {
    executablePath: resolve("tools/gh.exe"),
    metadataTimeoutMs: 500,
    discoveryTimeoutMs: 500,
    archiveTimeoutMs: 500,
    maxJsonOutputBytes: 16_384,
    maxDiscoveryOutputBytes: 65_536,
    maxStderrBytes: 1024,
    maxArchiveBytes: 1024 * 1024,
    maxConcurrentMetadataProcesses: 4,
    maxConcurrentArchiveProcesses: 2,
    ...overrides,
  };
}

function lease(secret: string, repositoryFullName = "acme/repository") {
  return new CredentialLease(secret, {
    internalCredentialId: "credential-internal",
    credentialVersion: 1,
    repositoryFullName,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function runnerWith(
  respond: (child: FakeChild, observed: ObservedSpawn) => void,
  observedCalls: ObservedSpawn[] = [],
): GitHubCliProcessRunner {
  return (executable, args, processOptions) => {
    const observed = {
      executable,
      args: [...args],
      options: {
        ...processOptions,
        env: { ...processOptions.env },
      },
    };
    observedCalls.push(observed);
    const child = new FakeChild();
    queueMicrotask(() => respond(child, observed));
    return child as unknown as ReturnType<GitHubCliProcessRunner>;
  };
}

function identity(login: string, id: number) {
  return {
    id,
    login,
    html_url: `https://github.com/${login}`,
    token: "raw-provider-field-must-not-cross",
  };
}

async function waitForCleanup(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await access(directory);
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
    } catch {
      return;
    }
  }
  throw new Error("temporary_directory_not_cleaned");
}

describe("GitHubCliRepositoryProvider process isolation", () => {
  it("uses only a minimal isolated environment and cleans GH_CONFIG_DIR", async () => {
    const previousGhToken = process.env.GH_TOKEN;
    const previousGitHubToken = process.env.GITHUB_TOKEN;
    process.env.GH_TOKEN = "global-gh-token-must-not-be-used";
    process.env.GITHUB_TOKEN = "global-github-token-must-not-be-used";
    const observed: ObservedSpawn[] = [];
    try {
      const provider = new GitHubCliRepositoryProvider(
        options(),
        runnerWith((child) => {
          child.stdout.end(JSON.stringify(identity("manager-a", 101)));
          child.emit("close", 0);
        }, observed),
      );

      await expect(
        provider.validateIdentity(lease(MANAGER_A_SECRET)),
      ).resolves.toEqual({
        id: "101",
        login: "manager-a",
        htmlUrl: "https://github.com/manager-a",
      });

      const call = observed[0];
      expect(call.executable).toBe(options().executablePath);
      expect(call.args).toEqual(expect.arrayContaining(["api", "user"]));
      expect(call.args.join(" ")).not.toMatch(/auth|config/u);
      expect(call.options.shell).toBe(false);
      expect(call.options.windowsHide).toBe(true);
      expect(call.options.env).toMatchObject({
        GH_TOKEN: MANAGER_A_SECRET,
        GH_HOST: "github.com",
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        GH_TELEMETRY: "0",
        DO_NOT_TRACK: "1",
      });
      expect(call.options.env.GITHUB_TOKEN).toBeUndefined();
      expect(call.options.env.GH_ENTERPRISE_TOKEN).toBeUndefined();
      expect(call.options.env.HOME).toBeUndefined();
      expect(process.env.GH_TOKEN).toBe("global-gh-token-must-not-be-used");
      expect(process.env.GITHUB_TOKEN).toBe(
        "global-github-token-must-not-be-used",
      );
      await waitForCleanup(call.options.env.GH_CONFIG_DIR as string);
    } finally {
      if (previousGhToken === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = previousGhToken;
      if (previousGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousGitHubToken;
    }
  });

  it("isolates two concurrent Manager credentials on one stateless adapter", async () => {
    const observed: ObservedSpawn[] = [];
    const provider = new GitHubCliRepositoryProvider(
      options(),
      runnerWith((child, call) => {
        const managerA = call.options.env.GH_TOKEN === MANAGER_A_SECRET;
        child.stdout.end(
          JSON.stringify(
            managerA ? identity("manager-a", 1) : identity("manager-b", 2),
          ),
        );
        child.emit("close", 0);
      }, observed),
    );

    const [managerA, managerB] = await Promise.all([
      provider.validateIdentity(lease(MANAGER_A_SECRET)),
      provider.validateIdentity(lease(MANAGER_B_SECRET)),
    ]);

    expect(managerA.login).toBe("manager-a");
    expect(managerB.login).toBe("manager-b");
    expect(observed.map((call) => call.options.env.GH_TOKEN).sort()).toEqual(
      [MANAGER_A_SECRET, MANAGER_B_SECRET].sort(),
    );
    expect(
      new Set(observed.map((call) => call.options.env.GH_CONFIG_DIR)).size,
    ).toBe(2);
    await Promise.all(
      observed.map((call) =>
        waitForCleanup(call.options.env.GH_CONFIG_DIR as string),
      ),
    );
    expect(Object.keys(provider)).not.toContain("credential");
  });

  it("never surfaces stderr containing a credential", async () => {
    const provider = new GitHubCliRepositoryProvider(
      options(),
      runnerWith((child) => {
        child.stderr.end(`HTTP 401 bad credentials ${MANAGER_A_SECRET}`);
        child.emit("close", 1);
      }),
    );

    let failure: unknown;
    try {
      await provider.validateIdentity(lease(MANAGER_A_SECRET));
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
    });
    expect(String(failure)).not.toContain(MANAGER_A_SECRET);
    expect(String(failure)).not.toContain("bad credentials");
  });
});

describe("GitHubCliRepositoryProvider validation and limits", () => {
  it("uses fixed injection-safe repository and revision arguments", async () => {
    const observed: ObservedSpawn[] = [];
    const sha = "a".repeat(40);
    const provider = new GitHubCliRepositoryProvider(
      options(),
      runnerWith((child) => {
        child.stdout.end(
          JSON.stringify({
            sha,
            url: `https://api.github.com/repos/acme/repository/commits/${sha}`,
            html_url: `https://github.com/acme/repository/commit/${sha}`,
            commit: { author: { date: null }, committer: { date: null } },
          }),
        );
        child.emit("close", 0);
      }, observed),
    );

    await provider.resolveCommit(
      lease(MANAGER_A_SECRET),
      "acme/repository",
      "refs/heads/main",
    );

    expect(observed[0].args).toContain(
      "repos/acme/repository/commits/refs%2Fheads%2Fmain",
    );
    expect(observed[0].args).not.toContain(MANAGER_A_SECRET);
  });

  it.each([
    ["other/repository", "main"],
    ["acme/repository;whoami", "main"],
    ["acme/repository", "bad\u0000revision"],
    ["acme/repository", "x".repeat(257)],
  ])(
    "rejects unsafe repository/revision input",
    async (repository, revision) => {
      const runner = jest.fn() as unknown as GitHubCliProcessRunner;
      const provider = new GitHubCliRepositoryProvider(options(), runner);

      await expect(
        provider.resolveCommit(lease(MANAGER_A_SECRET), repository, revision),
      ).rejects.toBeInstanceOf(Error);
      expect(runner).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON and oversized output safely", async () => {
    const malformed = new GitHubCliRepositoryProvider(
      options(),
      runnerWith((child) => {
        child.stdout.end("not-json");
        child.emit("close", 0);
      }),
    );
    await expect(
      malformed.validateIdentity(lease(MANAGER_A_SECRET)),
    ).rejects.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    });

    const oversized = new GitHubCliRepositoryProvider(
      options({ maxJsonOutputBytes: 8 }),
      runnerWith((child) => {
        child.stdout.end(JSON.stringify(identity("manager-a", 1)));
        child.emit("close", 0);
      }),
    );
    await expect(
      oversized.validateIdentity(lease(MANAGER_A_SECRET)),
    ).rejects.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    });
  });

  it("enforces discovery repository limits", async () => {
    const provider = new GitHubCliRepositoryProvider(
      options(),
      runnerWith((child) => {
        child.stdout.end(
          JSON.stringify([
            {
              id: 1,
              name: "one",
              full_name: "acme/one",
              default_branch: "main",
              private: true,
            },
            {
              id: 2,
              name: "two",
              full_name: "acme/two",
              default_branch: "main",
              private: true,
            },
          ]),
        );
        child.emit("close", 0);
      }),
    );

    await expect(
      provider.listAccessibleRepositories(lease(MANAGER_A_SECRET, "*"), {
        perPage: 1,
        maxPages: 1,
        maxRepositories: 1,
      }),
    ).rejects.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    });
  });

  it("maps process errors and timeouts without invalidating credentials", async () => {
    const processFailure = new GitHubCliRepositoryProvider(
      options(),
      runnerWith((child) => child.emit("error", new Error("spawn failed"))),
    );
    await expect(
      processFailure.validateIdentity(lease(MANAGER_A_SECRET)),
    ).rejects.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    });

    const timeout = new GitHubCliRepositoryProvider(
      options({ metadataTimeoutMs: 10 }),
      runnerWith(() => undefined),
    );
    await expect(
      timeout.validateIdentity(lease(MANAGER_A_SECRET)),
    ).rejects.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
    });
  });
});

describe("GitHubCliRepositoryProvider archive boundary", () => {
  it("streams archive bytes and marks redirect-host validation unresolved", async () => {
    const observed: ObservedSpawn[] = [];
    const sha = "b".repeat(40);
    const provider = new GitHubCliRepositoryProvider(
      options(),
      runnerWith((child) => {
        child.stdout.write(Buffer.alloc(256, 1));
        child.stdout.end(Buffer.alloc(256, 2));
        child.emit("close", 0);
      }, observed),
    );

    const archive = await provider.downloadArchive(
      lease(MANAGER_A_SECRET),
      "acme/repository",
      sha,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of archive.stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }

    expect(Buffer.concat(chunks)).toHaveLength(512);
    expect(archive.finalRedirectHostValidation).toBe(
      GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.unverified,
    );
    expect(archive).not.toHaveProperty("resolvedUrl");
    expect(observed[0].args).toContain(`repos/acme/repository/tarball/${sha}`);
  });

  it("supports AbortSignal cancellation and cleans the isolated directory", async () => {
    const observed: ObservedSpawn[] = [];
    const controller = new AbortController();
    const provider = new GitHubCliRepositoryProvider(
      options(),
      runnerWith(() => undefined, observed),
    );
    const archive = await provider.downloadArchive(
      lease(MANAGER_A_SECRET),
      "acme/repository",
      "c".repeat(40),
      controller.signal,
    );

    const errorPromise = new Promise<unknown>((resolvePromise) =>
      archive.stream.once("error", resolvePromise),
    );
    controller.abort();
    await expect(errorPromise).resolves.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled,
    });
    await waitForCleanup(observed[0].options.env.GH_CONFIG_DIR as string);
  });

  it("enforces archive byte and timeout limits without buffering the archive", async () => {
    const oversized = new GitHubCliRepositoryProvider(
      options({ maxArchiveBytes: 8 }),
      runnerWith((child) => {
        child.stdout.end(Buffer.alloc(16));
        child.emit("close", 0);
      }),
    );
    const oversizedArchive = await oversized.downloadArchive(
      lease(MANAGER_A_SECRET),
      "acme/repository",
      "d".repeat(40),
    );
    await expect(
      new Promise<unknown>((resolvePromise) =>
        oversizedArchive.stream.once("error", resolvePromise),
      ),
    ).resolves.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    });

    const timedOut = new GitHubCliRepositoryProvider(
      options({ archiveTimeoutMs: 10 }),
      runnerWith(() => undefined),
    );
    const timedOutArchive = await timedOut.downloadArchive(
      lease(MANAGER_A_SECRET),
      "acme/repository",
      "e".repeat(40),
    );
    await expect(
      new Promise<unknown>((resolvePromise) =>
        timedOutArchive.stream.once("error", resolvePromise),
      ),
    ).resolves.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
    });
  });

  it("rejects invalid SHAs before spawning", async () => {
    const runner = jest.fn() as unknown as GitHubCliProcessRunner;
    const provider = new GitHubCliRepositoryProvider(options(), runner);

    await expect(
      provider.downloadArchive(
        lease(MANAGER_A_SECRET),
        "acme/repository",
        "not-a-sha",
      ),
    ).rejects.toMatchObject({
      category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    });
    expect(runner).not.toHaveBeenCalled();
  });
});
