import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";

import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";

import type {
  GitHubIdentity,
  GitHubRepositoryMetadata,
  GitHubRepositoryPagePolicy,
  GitHubRepositoryProviderPort,
  GitHubRepositorySummary,
  GitHubResolvedCommit,
} from "../../application/ports/github-repository-provider.port.js";
import type { CredentialLease } from "../../application/security/credential-lease.js";

const GITLAB_HOST = "gitlab.com";
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const PROJECT_PATH_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/u;

export type GitLabCliRepositoryProviderOptions = {
  executablePath: string;
  host?: string;
  timeoutMs: number;
  maxJsonOutputBytes: number;
  spawnImpl?: typeof spawn;
};

export class GitLabCliProviderError extends Error {
  constructor(readonly category: GitHubCredentialErrorCode) {
    super(category);
    this.name = "GitLabCliProviderError";
  }
}

/** Encodes a GitLab namespaced project path for use as a REST :id segment. */
export function encodeGitLabProjectPath(pathWithNamespace: string): string {
  return encodeURIComponent(validateProjectPath(pathWithNamespace));
}

/** Stateless glab adapter. The token is scoped to one child process only. */
export class GitLabCliRepositoryProvider implements GitHubRepositoryProviderPort {
  private readonly host: string;

  constructor(private readonly options: GitLabCliRepositoryProviderOptions) {
    this.host = options.host ?? GITLAB_HOST;
    if (!isAbsolute(options.executablePath) || this.host !== GITLAB_HOST) {
      throw new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    }
  }

  async validateIdentity(credential: CredentialLease): Promise<GitHubIdentity> {
    const body = await this.runJson(credential, ["api", "user"]);
    if (
      !isRecord(body) ||
      !isId(body.id) ||
      typeof body.username !== "string"
    ) {
      throw new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }
    return {
      id: String(body.id),
      login: body.username,
      htmlUrl:
        typeof body.web_url === "string"
          ? body.web_url
          : `https://${this.host}/${body.username}`,
    };
  }

  async listAccessibleRepositories(
    credential: CredentialLease,
    pagePolicy: GitHubRepositoryPagePolicy,
  ): Promise<GitHubRepositorySummary[]> {
    const page = pagePolicy.startPage ?? 1;
    const body = await this.runJson(credential, [
      "api",
      `projects?membership=true&per_page=${pagePolicy.perPage}&page=${page}`,
    ]);
    if (!Array.isArray(body)) throw this.invalid();
    return body
      .slice(0, pagePolicy.maxRepositories)
      .map((item) => this.project(item));
  }

  async validateRepositoryAccess(
    credential: CredentialLease,
    repositoryFullName: string,
  ): Promise<GitHubRepositoryMetadata> {
    const path = validateProjectPath(repositoryFullName);
    return this.project(
      await this.runJson(credential, [
        "api",
        `projects/${encodeGitLabProjectPath(path)}`,
      ]),
    );
  }

  async resolveCommit(
    credential: CredentialLease,
    repositoryFullName: string,
    revision: string,
  ): Promise<GitHubResolvedCommit> {
    const path = validateProjectPath(repositoryFullName);
    const body = await this.runJson(credential, [
      "api",
      `projects/${encodeGitLabProjectPath(path)}/repository/commits/${encodeURIComponent(validateRevision(revision))}`,
    ]);
    if (
      !isRecord(body) ||
      typeof body.id !== "string" ||
      !SHA_PATTERN.test(body.id)
    ) {
      throw this.invalid();
    }
    return {
      sha: body.id.toLowerCase(),
      repositoryFullName: path,
      htmlUrl:
        typeof body.web_url === "string"
          ? body.web_url
          : `https://${this.host}/${path}/-/commit/${body.id}`,
      authorDate:
        typeof body.authored_date === "string" ? body.authored_date : null,
      committerDate:
        typeof body.committed_date === "string" ? body.committed_date : null,
    };
  }

  downloadArchive(): Promise<never> {
    return Promise.reject(
      new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      ),
    );
  }

  private project(value: unknown): GitHubRepositoryMetadata {
    if (
      !isRecord(value) ||
      !isId(value.id) ||
      typeof value.name !== "string" ||
      typeof value.path_with_namespace !== "string" ||
      !PROJECT_PATH_PATTERN.test(value.path_with_namespace) ||
      typeof value.default_branch !== "string" ||
      typeof value.web_url !== "string"
    ) {
      throw this.invalid();
    }
    return {
      id: String(value.id),
      name: value.name,
      fullName: value.path_with_namespace,
      defaultBranch: value.default_branch,
      private: value.visibility === "private",
    };
  }

  private invalid(): GitLabCliProviderError {
    return new GitLabCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }

  private async runJson(
    credential: CredentialLease,
    args: readonly string[],
  ): Promise<unknown> {
    const directory = await mkdtemp(`${tmpdir()}/lcsp-glab-`);
    try {
      const secret = credential.withSecret((value) => value);
      const result = await new Promise<{
        stdout: string;
        stderr: string;
        code: number;
      }>((resolve, reject) => {
        const child = (this.options.spawnImpl ?? spawn)(
          this.options.executablePath,
          args,
          {
            cwd: directory,
            shell: false,
            windowsHide: true,
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              WINDIR: process.env.WINDIR,
              TMP: process.env.TMP,
              TEMP: process.env.TEMP,
              GITLAB_TOKEN: secret,
              GITLAB_HOST: `https://${this.host}`,
              GLAB_CONFIG_DIR: directory,
              GLAB_PROMPT_DISABLED: "1",
              GLAB_SEND_TELEMETRY: "false",
              GLAB_CHECK_UPDATE: "false",
              GLAB_SHOW_WHATS_NEW: "false",
              GLAB_NO_PROMPT: "true",
              NO_COLOR: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (Buffer.byteLength(stdout) > this.options.maxJsonOutputBytes) {
            child.kill();
            reject(this.invalid());
          }
        });
        child.stderr?.on("data", (chunk: string) => {
          stderr += chunk;
          if (Buffer.byteLength(stderr) > 8192) stderr = stderr.slice(-8192);
        });
        const timeout = setTimeout(() => {
          child.kill();
          reject(
            new GitLabCliProviderError(
              GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
            ),
          );
        }, this.options.timeoutMs);
        child.once("error", () =>
          reject(
            new GitLabCliProviderError(
              GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
            ),
          ),
        );
        child.once("close", (code) => {
          clearTimeout(timeout);
          resolve({ stdout, code: code ?? -1, stderr });
        });
      });
      if (result.code !== 0) throw this.mapCommandFailure(result.stderr);
      try {
        return JSON.parse(result.stdout) as unknown;
      } catch {
        throw this.invalid();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private mapCommandFailure(stderr: string): GitLabCliProviderError {
    if (/\b401\b|unauthorized|invalid token/iu.test(stderr)) {
      return new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    if (/\b403\b|forbidden|insufficient_scope/iu.test(stderr)) {
      return new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
      );
    }
    if (/\b404\b|not found/iu.test(stderr)) {
      return new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      );
    }
    return new GitLabCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
}

function validateProjectPath(value: string): string {
  if (!PROJECT_PATH_PATTERN.test(value)) {
    throw new GitLabCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
    );
  }
  return value;
}

function validateRevision(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    throw new GitLabCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string | number {
  return (
    (typeof value === "string" && /^\d+$/u.test(value)) ||
    typeof value === "number"
  );
}
