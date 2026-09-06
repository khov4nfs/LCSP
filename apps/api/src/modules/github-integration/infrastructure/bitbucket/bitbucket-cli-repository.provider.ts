import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { isRecord } from "../../../../common/utils/index.js";
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

const BITBUCKET_HOST = "bitbucket.org";
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const REPOSITORY_FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export type BitbucketCliRepositoryProviderOptions = {
  executablePath: string;
  workspaceRoot?: string;
  host?: string;
  timeoutMs: number;
  maxJsonOutputBytes: number;
  spawnImpl?: typeof spawn;
};

export class BitbucketCliProviderError extends Error {
  constructor(readonly category: GitHubCredentialErrorCode) {
    super(category);
    this.name = "BitbucketCliProviderError";
  }
}

/** Stateless bb adapter. The token is scoped to one child process only. */
export class BitbucketCliRepositoryProvider implements GitHubRepositoryProviderPort {
  private readonly host: string;

  constructor(private readonly options: BitbucketCliRepositoryProviderOptions) {
    this.host = options.host ?? BITBUCKET_HOST;
    if (!options.executablePath.trim() || this.host !== BITBUCKET_HOST) {
      throw new BitbucketCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    }
  }

  async validateIdentity(credential: CredentialLease): Promise<GitHubIdentity> {
    const body = await this.runJson(credential, ["api", "2.0/user"]);
    if (!isRecord(body)) {
      throw new BitbucketCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }
    const id =
      typeof body.account_id === "string"
        ? body.account_id
        : typeof body.uuid === "string"
          ? body.uuid
          : typeof body.username === "string"
            ? body.username
            : undefined;
    const login =
      typeof body.username === "string"
        ? body.username
        : typeof body.nickname === "string"
          ? body.nickname
          : typeof body.display_name === "string"
            ? body.display_name
            : undefined;
    if (!id || !login) {
      throw new BitbucketCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }
    const htmlUrl =
      isRecord(body.links) &&
      isRecord(body.links.html) &&
      typeof body.links.html.href === "string"
        ? body.links.html.href
        : `https://${this.host}/${login}`;
    return {
      id,
      login,
      htmlUrl,
    };
  }

  async listAccessibleRepositories(
    credential: CredentialLease,
    pagePolicy: GitHubRepositoryPagePolicy,
  ): Promise<GitHubRepositorySummary[]> {
    const page = pagePolicy.startPage ?? 1;
    const perPage = Math.min(pagePolicy.perPage, 100);
    const body = await this.runJson(credential, [
      "api",
      `2.0/repositories?role=member&pagelen=${perPage}&page=${page}`,
    ]);
    if (!isRecord(body) || !Array.isArray(body.values)) {
      if (Array.isArray(body)) {
        return body
          .slice(0, pagePolicy.maxRepositories)
          .map((item) => this.project(item));
      }
      throw this.invalid();
    }
    return body.values
      .slice(0, pagePolicy.maxRepositories)
      .map((item) => this.project(item));
  }

  async validateRepositoryAccess(
    credential: CredentialLease,
    repositoryFullName: string,
  ): Promise<GitHubRepositoryMetadata> {
    const path = validateRepositoryPath(repositoryFullName);
    const [workspace, repo_slug] = path.split("/");
    return this.project(
      await this.runJson(credential, [
        "api",
        `2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo_slug)}`,
      ]),
    );
  }

  async resolveCommit(
    credential: CredentialLease,
    repositoryFullName: string,
    revision: string,
  ): Promise<GitHubResolvedCommit> {
    const path = validateRepositoryPath(repositoryFullName);
    const [workspace, repo_slug] = path.split("/");
    const body = await this.runJson(credential, [
      "api",
      `2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo_slug)}/commit/${encodeURIComponent(validateRevision(revision))}`,
    ]);
    if (
      !isRecord(body) ||
      typeof body.hash !== "string" ||
      !SHA_PATTERN.test(body.hash)
    ) {
      throw this.invalid();
    }
    const htmlUrl =
      isRecord(body.links) &&
      isRecord(body.links.html) &&
      typeof body.links.html.href === "string"
        ? body.links.html.href
        : `https://${this.host}/${path}/commits/${body.hash}`;
    const authorDate =
      typeof body.date === "string"
        ? body.date
        : isRecord(body.author) && typeof body.author.date === "string"
          ? body.author.date
          : null;
    return {
      sha: body.hash.toLowerCase(),
      repositoryFullName: path,
      htmlUrl,
      authorDate,
      committerDate: authorDate,
    };
  }

  downloadArchive(): Promise<never> {
    return Promise.reject(
      new BitbucketCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      ),
    );
  }

  private project(value: unknown): GitHubRepositoryMetadata {
    if (!isRecord(value)) throw this.invalid();
    const id =
      typeof value.uuid === "string"
        ? value.uuid
        : typeof value.id === "string" || typeof value.id === "number"
          ? String(value.id)
          : undefined;
    const name = typeof value.name === "string" ? value.name : undefined;
    const fullName =
      typeof value.full_name === "string"
        ? value.full_name
        : typeof value.path_with_namespace === "string"
          ? value.path_with_namespace
          : undefined;
    const defaultBranch =
      isRecord(value.mainbranch) && typeof value.mainbranch.name === "string"
        ? value.mainbranch.name
        : typeof value.default_branch === "string"
          ? value.default_branch
          : "main";
    const isPrivate =
      typeof value.is_private === "boolean"
        ? value.is_private
        : value.visibility === "private";

    if (
      !id ||
      !name ||
      !fullName ||
      !REPOSITORY_FULL_NAME_PATTERN.test(fullName)
    ) {
      throw this.invalid();
    }
    return {
      id,
      name,
      fullName,
      defaultBranch,
      private: isPrivate,
    };
  }

  private invalid(): BitbucketCliProviderError {
    return new BitbucketCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }

  private async runJson(
    credential: CredentialLease,
    args: readonly string[],
  ): Promise<unknown> {
    const directory = await mkdtemp(`${tmpdir()}/lcsp-bb-`);
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
            cwd: this.options.workspaceRoot ?? directory,
            shell: false,
            windowsHide: true,
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              WINDIR: process.env.WINDIR,
              TMP: process.env.TMP,
              TEMP: process.env.TEMP,
              BITBUCKET_TOKEN: secret,
              BITBUCKET_APP_PASSWORD: secret,
              BITBUCKET_CONFIG_DIR: directory,
              BB_CONFIG_DIR: directory,
              BB_NO_PROMPT: "true",
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
            new BitbucketCliProviderError(
              GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
            ),
          );
        }, this.options.timeoutMs);
        child.once("error", () =>
          reject(
            new BitbucketCliProviderError(
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

  private mapCommandFailure(stderr: string): BitbucketCliProviderError {
    if (/\b401\b|unauthorized|invalid token|access denied/iu.test(stderr)) {
      return new BitbucketCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    if (/\b403\b|forbidden|insufficient_scope/iu.test(stderr)) {
      return new BitbucketCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
      );
    }
    if (/\b404\b|not found/iu.test(stderr)) {
      return new BitbucketCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      );
    }
    return new BitbucketCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
}

function validateRepositoryPath(value: string): string {
  if (!REPOSITORY_FULL_NAME_PATTERN.test(value)) {
    throw new BitbucketCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
    );
  }
  return value;
}

function validateRevision(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    throw new BitbucketCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  return value;
}
