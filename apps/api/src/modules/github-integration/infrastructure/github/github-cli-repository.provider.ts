import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";

import { isRecord } from "../../../../common/utils/index.js";
import {
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_CREDENTIAL_ERROR_CODES,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";

import type {
  GitHubArchiveStream,
  GitHubIdentity,
  GitHubRepositoryMetadata,
  GitHubRepositoryPagePolicy,
  GitHubRepositoryProviderPort,
  GitHubRepositorySummary,
  GitHubResolvedCommit,
} from "../../application/ports/github-repository-provider.port.js";
import {
  CredentialLeaseError,
  type CredentialLease,
} from "../../application/security/credential-lease.js";

const GITHUB_HOST = "github.com";
const GITHUB_API_VERSION = "2022-11-28";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const MAX_REVISION_LENGTH = 256;
const DISCOVERY_MIN_PER_PAGE = 1;
const DISCOVERY_MAX_PER_PAGE = 100;
const GH_CONFIG_DIRECTORY_PREFIX = "lcsp-gh-";

export type GitHubCliProcessOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  stdio: ["ignore", "pipe", "pipe"];
  windowsHide: true;
};

export type GitHubCliProcessRunner = (
  executablePath: string,
  args: readonly string[],
  options: GitHubCliProcessOptions,
) => GitHubCliChildProcess;

export type GitHubCliChildProcess = ChildProcessByStdio<
  null,
  Readable,
  Readable
>;

export type GitHubCliRepositoryProviderOptions = {
  executablePath: string;
  metadataTimeoutMs: number;
  discoveryTimeoutMs: number;
  archiveTimeoutMs: number;
  maxJsonOutputBytes: number;
  maxDiscoveryOutputBytes: number;
  maxStderrBytes: number;
  maxArchiveBytes: number;
  maxConcurrentMetadataProcesses: number;
  maxConcurrentArchiveProcesses: number;
};

/** Safe provider failure containing only a contract category. */
export class GitHubCliProviderError extends Error {
  constructor(readonly category: GitHubCredentialErrorCode) {
    super(category);
    this.name = "GitHubCliProviderError";
  }
}

/**
 * Stateless GitHub CLI adapter. Credentials are supplied per operation through
 * CredentialLease and are never retained on the adapter instance.
 */
export class GitHubCliRepositoryProvider implements GitHubRepositoryProviderPort {
  private readonly metadataSemaphore: Semaphore;
  private readonly archiveSemaphore: Semaphore;

  constructor(
    private readonly options: GitHubCliRepositoryProviderOptions,
    private readonly processRunner: GitHubCliProcessRunner = (
      executablePath,
      args,
      processOptions,
    ) => spawn(executablePath, [...args], processOptions),
  ) {
    if (!isAbsolute(options.executablePath)) {
      throw new GitHubCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    }
    assertPositiveInteger(options.metadataTimeoutMs);
    assertPositiveInteger(options.discoveryTimeoutMs);
    assertPositiveInteger(options.archiveTimeoutMs);
    assertPositiveInteger(options.maxJsonOutputBytes);
    assertPositiveInteger(options.maxDiscoveryOutputBytes);
    assertPositiveInteger(options.maxStderrBytes);
    assertPositiveInteger(options.maxArchiveBytes);
    this.metadataSemaphore = new Semaphore(
      options.maxConcurrentMetadataProcesses,
    );
    this.archiveSemaphore = new Semaphore(
      options.maxConcurrentArchiveProcesses,
    );
  }

  async validateIdentity(credential: CredentialLease): Promise<GitHubIdentity> {
    const body = await this.runJson(
      credential,
      ["api", "user", ...apiHeaders()],
      this.options.metadataTimeoutMs,
      this.options.maxJsonOutputBytes,
    );
    if (
      !isRecord(body) ||
      !isProviderId(body.id) ||
      typeof body.login !== "string" ||
      typeof body.html_url !== "string" ||
      body.html_url !== `https://github.com/${body.login}`
    ) {
      throw providerResponseInvalid();
    }
    return {
      id: String(body.id),
      login: body.login,
      htmlUrl: body.html_url,
    };
  }

  async listAccessibleRepositories(
    credential: CredentialLease,
    pagePolicy: GitHubRepositoryPagePolicy,
  ): Promise<GitHubRepositorySummary[]> {
    assertPagePolicy(pagePolicy);
    const repositories: GitHubRepositorySummary[] = [];
    let totalBytes = 0;

    const startPage = pagePolicy.startPage ?? 1;
    const lastPage = startPage + pagePolicy.maxPages - 1;
    for (let page = startPage; page <= lastPage; page += 1) {
      const result = await this.runJsonWithByteCount(
        credential,
        [
          "api",
          `user/repos?per_page=${pagePolicy.perPage}&page=${page}&affiliation=owner,collaborator,organization_member`,
          ...apiHeaders(),
        ],
        this.options.discoveryTimeoutMs,
        this.options.maxDiscoveryOutputBytes - totalBytes,
      );
      totalBytes += result.bytes;
      if (!Array.isArray(result.body)) {
        throw providerResponseInvalid();
      }
      for (const row of result.body) {
        repositories.push(projectRepository(row));
        if (repositories.length > pagePolicy.maxRepositories) {
          throw providerResponseInvalid();
        }
      }
      if (result.body.length < pagePolicy.perPage) {
        break;
      }
    }

    return repositories;
  }

  async validateRepositoryAccess(
    credential: CredentialLease,
    repositoryFullName: string,
    allowCanonicalRename = false,
  ): Promise<GitHubRepositoryMetadata> {
    const repository = validateRepositoryScope(credential, repositoryFullName);
    const body = await this.runJson(
      credential,
      ["api", `repos/${repository}`, ...apiHeaders()],
      this.options.metadataTimeoutMs,
      this.options.maxJsonOutputBytes,
    );
    const metadata = projectRepository(body);
    if (!allowCanonicalRename && metadata.fullName !== repository) {
      throw providerResponseInvalid();
    }
    return metadata;
  }

  async resolveCommit(
    credential: CredentialLease,
    repositoryFullName: string,
    revision: string,
  ): Promise<GitHubResolvedCommit> {
    const repository = validateRepositoryScope(credential, repositoryFullName);
    const safeRevision = validateRevision(revision);
    const body = await this.runJson(
      credential,
      [
        "api",
        `repos/${repository}/commits/${encodeURIComponent(safeRevision)}`,
        ...apiHeaders(),
      ],
      this.options.metadataTimeoutMs,
      this.options.maxJsonOutputBytes,
    );
    if (
      !isRecord(body) ||
      typeof body.sha !== "string" ||
      !COMMIT_SHA_PATTERN.test(body.sha) ||
      typeof body.url !== "string" ||
      !body.url.startsWith(
        `https://api.github.com/repos/${repository}/commits/`,
      ) ||
      typeof body.html_url !== "string" ||
      !body.html_url.startsWith(`https://github.com/${repository}/commit/`)
    ) {
      throw providerResponseInvalid();
    }
    const commit = isRecord(body.commit) ? body.commit : null;
    const author = commit && isRecord(commit.author) ? commit.author : null;
    const committer =
      commit && isRecord(commit.committer) ? commit.committer : null;
    return {
      sha: body.sha.toLowerCase(),
      repositoryFullName: repository,
      htmlUrl: body.html_url,
      authorDate: optionalString(author?.date),
      committerDate: optionalString(committer?.date),
    };
  }

  async downloadArchive(
    credential: CredentialLease,
    repositoryFullName: string,
    commitSha: string,
    abortSignal?: AbortSignal,
  ): Promise<GitHubArchiveStream> {
    const repository = validateRepositoryScope(credential, repositoryFullName);
    const sha = validateCommitSha(commitSha);
    const release = await this.archiveSemaphore.acquire(abortSignal);
    let directory: string | null = null;
    try {
      directory = await createIsolatedConfigDirectory();
      const child = this.spawnWithCredential(
        credential,
        ["api", `repos/${repository}/tarball/${sha}`, ...apiHeaders()],
        directory,
      );
      const stderr = collectBoundedStderr(child, this.options.maxStderrBytes);
      const limiter = new ArchiveByteLimitTransform(
        this.options.maxArchiveBytes,
        () => child.kill(),
      );
      child.stdout.pipe(limiter);
      const operation = manageChildLifetime({
        child,
        timeoutMs: this.options.archiveTimeoutMs,
        abortSignal,
        stderr,
      });
      const cleanup = (): void => {
        release();
        void removeIsolatedConfigDirectory(directory);
      };
      child.once("error", () => {
        limiter.destroy(
          new GitHubCliProviderError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
          ),
        );
      });
      operation.then(
        (exitCode) => {
          if (exitCode !== 0) {
            limiter.destroy(mapNonZeroExit(stderr.value));
          }
          cleanup();
        },
        (error: unknown) => {
          limiter.destroy(asSafeProviderError(error));
          cleanup();
        },
      );
      return {
        stream: limiter,
        contentType: "application/gzip",
        repositoryFullName: repository,
        commitSha: sha,
        finalRedirectHostValidation:
          GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.unverified,
      };
    } catch (error: unknown) {
      release();
      await removeIsolatedConfigDirectory(directory);
      throw asSafeProviderError(error);
    }
  }

  private async runJson(
    credential: CredentialLease,
    args: readonly string[],
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<unknown> {
    return (
      await this.runJsonWithByteCount(
        credential,
        args,
        timeoutMs,
        maxOutputBytes,
      )
    ).body;
  }

  private async runJsonWithByteCount(
    credential: CredentialLease,
    args: readonly string[],
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<{ body: unknown; bytes: number }> {
    const release = await this.metadataSemaphore.acquire();
    let directory: string | null = null;
    try {
      directory = await createIsolatedConfigDirectory();
      const child = this.spawnWithCredential(credential, args, directory);
      const stderr = collectBoundedStderr(child, this.options.maxStderrBytes);
      const stdout = await collectBoundedStdout(
        child,
        maxOutputBytes,
        timeoutMs,
        stderr,
      );
      let body: unknown;
      try {
        body = JSON.parse(stdout.value) as unknown;
      } catch {
        throw providerResponseInvalid();
      }
      return { body, bytes: stdout.bytes };
    } catch (error: unknown) {
      throw asSafeProviderError(error);
    } finally {
      release();
      await removeIsolatedConfigDirectory(directory);
    }
  }

  private spawnWithCredential(
    credential: CredentialLease,
    args: readonly string[],
    directory: string,
  ): GitHubCliChildProcess {
    try {
      return credential.withSecret((secret) => {
        const environment = buildChildEnvironment(secret, directory);
        try {
          return this.processRunner(this.options.executablePath, args, {
            cwd: directory,
            env: environment,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          });
        } finally {
          delete environment.GH_TOKEN;
        }
      });
    } catch (error: unknown) {
      if (error instanceof CredentialLeaseError) {
        throw new GitHubCliProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired,
        );
      }
      throw asSafeProviderError(error);
    }
  }
}

function buildChildEnvironment(
  secret: string,
  configDirectory: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GH_TOKEN: secret,
    GH_HOST: GITHUB_HOST,
    GH_CONFIG_DIR: configDirectory,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_TELEMETRY: "0",
    DO_NOT_TRACK: "1",
    TMP: configDirectory,
    TEMP: configDirectory,
  };
  for (const name of [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "SSL_CERT_FILE",
  ] as const) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function apiHeaders(): string[] {
  return [
    "--method",
    "GET",
    "--header",
    "Accept: application/vnd.github+json",
    "--header",
    `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
  ];
}

async function createIsolatedConfigDirectory(): Promise<string> {
  try {
    const directory = await mkdtemp(join(tmpdir(), GH_CONFIG_DIRECTORY_PREFIX));
    await chmod(directory, 0o700);
    return directory;
  } catch {
    throw new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
}

async function removeIsolatedConfigDirectory(
  directory: string | null,
): Promise<void> {
  if (!directory) return;
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

function collectBoundedStderr(
  child: GitHubCliChildProcess,
  maxBytes: number,
): { value: string } {
  const result = { value: "" };
  let bytes = 0;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (bytes >= maxBytes) return;
    const remaining = maxBytes - bytes;
    result.value += chunk.slice(0, remaining);
    bytes += Buffer.byteLength(chunk, "utf8");
  });
  return result;
}

function collectBoundedStdout(
  child: GitHubCliChildProcess,
  maxBytes: number,
  timeoutMs: number,
  stderr: { value: string },
): Promise<{ value: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    let value = "";
    let bytes = 0;
    let settled = false;
    child.stdout.setEncoding("utf8");
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new GitHubCliProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
        ),
      );
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > maxBytes) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(providerResponseInvalid());
        return;
      }
      value += chunk;
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new GitHubCliProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
        ),
      );
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(mapNonZeroExit(stderr.value));
        return;
      }
      resolve({ value, bytes });
    });
  });
}

function manageChildLifetime(input: {
  child: GitHubCliChildProcess;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  stderr: { value: string };
}): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.abortSignal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      input.child.kill();
      finish(() =>
        reject(
          new GitHubCliProviderError(
            GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled,
          ),
        ),
      );
    };
    const timer = setTimeout(() => {
      input.child.kill();
      finish(() =>
        reject(
          new GitHubCliProviderError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
          ),
        ),
      );
    }, input.timeoutMs);
    timer.unref();
    if (input.abortSignal?.aborted) {
      onAbort();
      return;
    }
    input.abortSignal?.addEventListener("abort", onAbort, { once: true });
    input.child.once("error", () =>
      finish(() =>
        reject(
          new GitHubCliProviderError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
          ),
        ),
      ),
    );
    input.child.once("close", (exitCode) => finish(() => resolve(exitCode)));
  });
}

function mapNonZeroExit(stderr: string): GitHubCliProviderError {
  const normalized = stderr.toLowerCase();
  if (/\b(401|bad credentials|requires authentication)\b/u.test(normalized)) {
    return new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
    );
  }
  if (/\b(sso|saml|approval required|pending approval)\b/u.test(normalized)) {
    return new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.credentialApprovalRequired,
    );
  }
  if (/\b(429|rate limit|secondary rate)\b/u.test(normalized)) {
    return new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited,
    );
  }
  if (/\b403\b/u.test(normalized)) {
    return new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
    );
  }
  if (/\b404\b/u.test(normalized)) {
    return new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
    );
  }
  if (/\b409\b|git repository is empty|repository is empty/u.test(normalized)) {
    return new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
    );
  }
  return providerResponseInvalid();
}

function asSafeProviderError(error: unknown): GitHubCliProviderError {
  return error instanceof GitHubCliProviderError
    ? error
    : providerResponseInvalid();
}

function providerResponseInvalid(): GitHubCliProviderError {
  return new GitHubCliProviderError(
    GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
  );
}

function validateRepositoryScope(
  credential: CredentialLease,
  value: string,
): string {
  const repository = value.trim();
  if (
    !REPOSITORY_PATTERN.test(repository) ||
    credential.repositoryFullName !== repository
  ) {
    throw new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
    );
  }
  return repository;
}

function validateRevision(value: string): string {
  const revision = value.trim();
  if (
    !revision ||
    revision.length > MAX_REVISION_LENGTH ||
    [...revision].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    throw providerResponseInvalid();
  }
  return revision;
}

function validateCommitSha(value: string): string {
  const sha = value.trim().toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(sha)) {
    throw providerResponseInvalid();
  }
  return sha;
}

function assertPagePolicy(policy: GitHubRepositoryPagePolicy): void {
  if (
    !Number.isInteger(policy.perPage) ||
    policy.perPage < DISCOVERY_MIN_PER_PAGE ||
    policy.perPage > DISCOVERY_MAX_PER_PAGE ||
    !Number.isInteger(policy.maxPages) ||
    policy.maxPages <= 0 ||
    !Number.isInteger(policy.maxRepositories) ||
    policy.maxRepositories <= 0 ||
    policy.maxRepositories > policy.perPage * policy.maxPages ||
    (policy.startPage !== undefined &&
      (!Number.isInteger(policy.startPage) ||
        policy.startPage < 1 ||
        policy.startPage > 1000))
  ) {
    throw providerResponseInvalid();
  }
}

function assertPositiveInteger(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
}

function projectRepository(value: unknown): GitHubRepositorySummary {
  if (
    !isRecord(value) ||
    !isProviderId(value.id) ||
    typeof value.name !== "string" ||
    typeof value.full_name !== "string" ||
    !REPOSITORY_PATTERN.test(value.full_name) ||
    typeof value.default_branch !== "string" ||
    typeof value.private !== "boolean"
  ) {
    throw providerResponseInvalid();
  }
  return {
    id: String(value.id),
    name: value.name,
    fullName: value.full_name,
    defaultBranch: value.default_branch,
    private: value.private,
  };
}

function isProviderId(value: unknown): value is string | number {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^\d+$/u.test(value))
  );
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

class ArchiveByteLimitTransform extends Transform {
  private bytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly terminate: () => void,
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      this.terminate();
      callback(providerResponseInvalid());
      return;
    }
    callback(null, chunk);
  }
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    assertPositiveInteger(limit);
  }

  async acquire(abortSignal?: AbortSignal): Promise<() => void> {
    if (abortSignal?.aborted) {
      throw new GitHubCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled,
      );
    }
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          const index = this.waiting.indexOf(onAvailable);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(
            new GitHubCliProviderError(
              GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled,
            ),
          );
        };
        const onAvailable = (): void => {
          abortSignal?.removeEventListener("abort", onAbort);
          resolve();
        };
        this.waiting.push(onAvailable);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}
