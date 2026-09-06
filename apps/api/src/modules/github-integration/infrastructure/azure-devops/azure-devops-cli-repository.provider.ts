import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";
import { isRecord } from "../../../../common/utils/index.js";

import type {
  GitHubIdentity,
  GitHubRepositoryMetadata,
  GitHubRepositoryPagePolicy,
  GitHubRepositoryProviderPort,
  GitHubRepositorySummary,
  GitHubResolvedCommit,
} from "../../application/ports/github-repository-provider.port.js";
import type { CredentialLease } from "../../application/security/credential-lease.js";

const DEFAULT_HOST = "dev.azure.com";
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const REPOSITORY_PATH_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/u;

export type AzureDevOpsCliRepositoryProviderOptions = {
  executablePath: string;
  workspaceRoot?: string;
  host?: string;
  timeoutMs: number;
  maxJsonOutputBytes: number;
  spawnImpl?: typeof spawn;
};

export class AzureDevOpsCliProviderError extends Error {
  constructor(readonly category: GitHubCredentialErrorCode) {
    super(category);
    this.name = "AzureDevOpsCliProviderError";
  }
}

/** Stateless az CLI adapter. The token is scoped to one child process only. */
export class AzureDevOpsCliRepositoryProvider implements GitHubRepositoryProviderPort {
  private readonly host: string;

  constructor(
    private readonly options: AzureDevOpsCliRepositoryProviderOptions,
  ) {
    this.host = options.host ?? DEFAULT_HOST;
    if (!options.executablePath.trim()) {
      throw new AzureDevOpsCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    }
  }

  async validateIdentity(credential: CredentialLease): Promise<GitHubIdentity> {
    const rawSecret = credential.withSecret((value) => value);
    const [possibleOrg, actualPat] = rawSecret.includes(":")
      ? [
          rawSecret.slice(0, rawSecret.indexOf(":")).trim(),
          rawSecret.slice(rawSecret.indexOf(":") + 1).trim(),
        ]
      : ["", rawSecret.trim()];
    const pat = actualPat || rawSecret;
    const basicAuth = Buffer.from(`:${pat}`).toString("base64");

    const candidateOrgs: string[] = [];
    if (possibleOrg) candidateOrgs.push(possibleOrg);

    // 1. Try discovering accounts via global Microsoft API for "All accessible organizations" tokens
    try {
      const profileRes = await fetch(
        "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1-preview.1",
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
        },
      );
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as Record<string, unknown>;
        const memberId =
          typeof profile.id === "string" ? profile.id : undefined;
        if (memberId) {
          const accountsRes = await fetch(
            `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${encodeURIComponent(memberId)}&api-version=7.1-preview.1`,
            {
              headers: {
                Authorization: `Basic ${basicAuth}`,
                Accept: "application/json",
              },
            },
          );
          if (accountsRes.ok) {
            const accountsData = (await accountsRes.json()) as Record<
              string,
              unknown
            >;
            if (Array.isArray(accountsData.value)) {
              for (const acc of accountsData.value) {
                if (isRecord(acc) && typeof acc.accountName === "string") {
                  if (!candidateOrgs.includes(acc.accountName)) {
                    candidateOrgs.push(acc.accountName);
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Ignore global endpoint errors for org-scoped PATs
    }

    // 2. Add user email prefix as a candidate org if available
    if (
      credential.repositoryFullName &&
      credential.repositoryFullName !== "provider-account"
    ) {
      const emailPart = credential.repositoryFullName.includes("@")
        ? credential.repositoryFullName.split("@")[0].trim()
        : credential.repositoryFullName.split("/")[0].trim();
      if (emailPart && !candidateOrgs.includes(emailPart)) {
        candidateOrgs.push(emailPart);
      }
    }

    // 3. Probe connectionData across all candidate orgs
    for (const org of candidateOrgs) {
      try {
        const res = await fetch(
          `https://dev.azure.com/${encodeURIComponent(org)}/_apis/connectionData`,
          {
            headers: {
              Authorization: `Basic ${basicAuth}`,
              Accept: "application/json",
            },
          },
        );
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          const user = isRecord(data.authenticatedUser)
            ? data.authenticatedUser
            : {};
          const props = isRecord(user.properties) ? user.properties : {};
          const accountProp = isRecord(props.Account) ? props.Account : {};
          const id =
            typeof user.id === "string"
              ? user.id
              : typeof accountProp.$value === "string"
                ? accountProp.$value
                : undefined;
          const login =
            typeof accountProp.$value === "string"
              ? accountProp.$value
              : typeof user.providerDisplayName === "string"
                ? user.providerDisplayName
                : typeof user.customDisplayName === "string"
                  ? user.customDisplayName
                  : undefined;
          if (id && login) {
            return {
              id,
              login,
              htmlUrl: `https://${this.host}/${org}`,
            };
          }
        }
      } catch (error: unknown) {
        if (error instanceof AzureDevOpsCliProviderError) throw error;
      }
    }

    // 4. Try global profile endpoint as fallback identity
    try {
      const res = await fetch(
        "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1-preview.1",
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
        },
      );
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        const id =
          typeof body.id === "string"
            ? body.id
            : typeof body.emailAddress === "string"
              ? body.emailAddress
              : typeof body.publicAlias === "string"
                ? body.publicAlias
                : undefined;
        const login =
          typeof body.emailAddress === "string"
            ? body.emailAddress
            : typeof body.displayName === "string"
              ? body.displayName
              : typeof body.publicAlias === "string"
                ? body.publicAlias
                : undefined;
        if (id && login) {
          return {
            id,
            login,
            htmlUrl: `https://${this.host}/${login}`,
          };
        }
      }
    } catch (error: unknown) {
      if (error instanceof AzureDevOpsCliProviderError) throw error;
    }

    // 5. Fallback to CLI
    const body = await this.runJson(credential, [
      "devops",
      "user",
      "show",
      "--output",
      "json",
    ]).catch(async () =>
      this.runJson(credential, ["account", "show", "--output", "json"]),
    );

    if (!isRecord(body)) {
      throw new AzureDevOpsCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    const userObj = isRecord(body.user) ? body.user : body;
    const id =
      typeof userObj.id === "string"
        ? userObj.id
        : typeof userObj.mailAddress === "string"
          ? userObj.mailAddress
          : typeof userObj.principalName === "string"
            ? userObj.principalName
            : typeof userObj.name === "string"
              ? userObj.name
              : undefined;
    const login =
      typeof userObj.principalName === "string"
        ? userObj.principalName
        : typeof userObj.mailAddress === "string"
          ? userObj.mailAddress
          : typeof userObj.name === "string"
            ? userObj.name
            : typeof userObj.displayName === "string"
              ? userObj.displayName
              : undefined;
    if (!id || !login) {
      throw new AzureDevOpsCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    return {
      id,
      login,
      htmlUrl: `https://${this.host}/${login}`,
    };
  }

  async listAccessibleRepositories(
    credential: CredentialLease,
    pagePolicy: GitHubRepositoryPagePolicy,
  ): Promise<GitHubRepositorySummary[]> {
    const rawSecret = credential.withSecret((value) => value);
    const [possibleOrg, actualPat] = rawSecret.includes(":")
      ? [
          rawSecret.slice(0, rawSecret.indexOf(":")).trim(),
          rawSecret.slice(rawSecret.indexOf(":") + 1).trim(),
        ]
      : ["", rawSecret.trim()];
    const pat = actualPat || rawSecret;
    const basicAuth = Buffer.from(`:${pat}`).toString("base64");

    const candidateOrgs: string[] = [];
    if (possibleOrg) candidateOrgs.push(possibleOrg);

    // Try global accounts
    try {
      const profileRes = await fetch(
        "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1-preview.1",
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
        },
      );
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as Record<string, unknown>;
        const memberId =
          typeof profile.id === "string" ? profile.id : undefined;
        if (memberId) {
          const accountsRes = await fetch(
            `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${encodeURIComponent(memberId)}&api-version=7.1-preview.1`,
            {
              headers: {
                Authorization: `Basic ${basicAuth}`,
                Accept: "application/json",
              },
            },
          );
          if (accountsRes.ok) {
            const accountsData = (await accountsRes.json()) as Record<
              string,
              unknown
            >;
            if (Array.isArray(accountsData.value)) {
              for (const acc of accountsData.value) {
                if (isRecord(acc) && typeof acc.accountName === "string") {
                  if (!candidateOrgs.includes(acc.accountName)) {
                    candidateOrgs.push(acc.accountName);
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Ignore
    }

    if (
      credential.repositoryFullName &&
      credential.repositoryFullName !== "provider-account"
    ) {
      const emailPart = credential.repositoryFullName.includes("@")
        ? credential.repositoryFullName.split("@")[0].trim()
        : credential.repositoryFullName.split("/")[0].trim();
      if (emailPart && !candidateOrgs.includes(emailPart)) {
        candidateOrgs.push(emailPart);
      }
    }

    const repos: GitHubRepositorySummary[] = [];
    for (const org of candidateOrgs) {
      try {
        const res = await fetch(
          `https://dev.azure.com/${encodeURIComponent(org)}/_apis/git/repositories?api-version=7.1-preview.1`,
          {
            headers: {
              Authorization: `Basic ${basicAuth}`,
              Accept: "application/json",
            },
          },
        );
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          if (Array.isArray(data.value)) {
            for (const item of data.value) {
              if (isRecord(item)) {
                const id = typeof item.id === "string" ? item.id : undefined;
                const name =
                  typeof item.name === "string" ? item.name : undefined;
                const project = isRecord(item.project)
                  ? item.project
                  : undefined;
                const projectName =
                  project && typeof project.name === "string"
                    ? project.name
                    : undefined;
                if (id && name && projectName) {
                  const defaultBranch =
                    typeof item.defaultBranch === "string"
                      ? item.defaultBranch.replace(/^refs\/heads\//u, "")
                      : "main";
                  const isPrivate =
                    project && typeof project.visibility === "string"
                      ? project.visibility.toLowerCase() === "private"
                      : true;
                  repos.push({
                    id,
                    name,
                    fullName: `${projectName}/${name}`,
                    defaultBranch,
                    private: isPrivate,
                  });
                  if (repos.length >= pagePolicy.maxRepositories) {
                    return repos;
                  }
                }
              }
            }
          }
        }
      } catch {
        // Ignore and continue
      }
    }

    if (repos.length > 0) {
      return repos;
    }

    // CLI fallback
    const body = await this.runJson(credential, [
      "repos",
      "list",
      "--output",
      "json",
    ]).catch(() => []);
    if (!Array.isArray(body)) throw this.invalid();
    return body
      .slice(0, pagePolicy.maxRepositories)
      .map((item) => this.project(item));
  }

  async validateRepositoryAccess(
    credential: CredentialLease,
    repositoryFullName: string,
  ): Promise<GitHubRepositoryMetadata> {
    const { org, project, repo } = parseRepoParts(repositoryFullName);
    const args = ["repos", "show", "--repository", repo, "--output", "json"];
    if (project) args.push("--project", project);
    if (org) args.push("--org", `https://${this.host}/${org}`);
    return this.project(await this.runJson(credential, args));
  }

  async resolveCommit(
    credential: CredentialLease,
    repositoryFullName: string,
    revision: string,
  ): Promise<GitHubResolvedCommit> {
    const { org, project, repo } = parseRepoParts(repositoryFullName);
    const args = [
      "repos",
      "commit",
      "show",
      "--commit-id",
      validateRevision(revision),
      "--repository",
      repo,
      "--output",
      "json",
    ];
    if (project) args.push("--project", project);
    if (org) args.push("--org", `https://${this.host}/${org}`);
    const body = await this.runJson(credential, args);
    if (!isRecord(body)) throw this.invalid();
    const commitId =
      typeof body.commitId === "string"
        ? body.commitId
        : typeof body.id === "string"
          ? body.id
          : typeof body.sha === "string"
            ? body.sha
            : undefined;
    if (!commitId || !SHA_PATTERN.test(commitId)) {
      throw this.invalid();
    }
    const author = isRecord(body.author) ? body.author : undefined;
    const committer = isRecord(body.committer) ? body.committer : undefined;
    const authorDate =
      author && typeof author.date === "string" ? author.date : null;
    const committerDate =
      committer && typeof committer.date === "string" ? committer.date : null;
    const htmlUrl =
      typeof body.remoteUrl === "string"
        ? `${body.remoteUrl}/commit/${commitId}`
        : typeof body.url === "string"
          ? body.url
          : `https://${this.host}/${repositoryFullName}/commit/${commitId}`;
    return {
      sha: commitId.toLowerCase(),
      repositoryFullName,
      htmlUrl,
      authorDate,
      committerDate,
    };
  }

  downloadArchive(): Promise<never> {
    return Promise.reject(
      new AzureDevOpsCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      ),
    );
  }

  private project(value: unknown): GitHubRepositoryMetadata {
    if (!isRecord(value)) throw this.invalid();
    const id =
      typeof value.id === "string"
        ? value.id
        : typeof value.id === "number"
          ? String(value.id)
          : undefined;
    const name = typeof value.name === "string" ? value.name : undefined;
    const project = isRecord(value.project) ? value.project : undefined;
    const projectName =
      project && typeof project.name === "string" ? project.name : undefined;
    const fullName =
      typeof value.full_name === "string"
        ? value.full_name
        : typeof value.path_with_namespace === "string"
          ? value.path_with_namespace
          : projectName && name
            ? `${projectName}/${name}`
            : name;
    const defaultBranch =
      typeof value.defaultBranch === "string"
        ? value.defaultBranch.replace(/^refs\/heads\//u, "")
        : typeof value.default_branch === "string"
          ? value.default_branch
          : "main";
    const isPrivate =
      typeof value.isPrivate === "boolean"
        ? value.isPrivate
        : typeof value.is_private === "boolean"
          ? value.is_private
          : project && typeof project.visibility === "string"
            ? project.visibility.toLowerCase() === "private"
            : true;

    if (!id || !name || !fullName || !REPOSITORY_PATH_PATTERN.test(fullName)) {
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

  private invalid(): AzureDevOpsCliProviderError {
    return new AzureDevOpsCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }

  private async runJson(
    credential: CredentialLease,
    args: readonly string[],
  ): Promise<unknown> {
    const directory = await mkdtemp(`${tmpdir()}/lcsp-az-`);
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
              AZURE_DEVOPS_EXT_PAT: secret,
              AZURE_CONFIG_DIR: directory,
              AZ_CONFIG_DIR: directory,
              AZURE_CLI_DISABLE_CONNECTION_VERIFICATION: "1",
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
            new AzureDevOpsCliProviderError(
              GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
            ),
          );
        }, this.options.timeoutMs);
        child.once("error", () =>
          reject(
            new AzureDevOpsCliProviderError(
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

  private mapCommandFailure(stderr: string): AzureDevOpsCliProviderError {
    if (/\b401\b|unauthorized|invalid token|access denied/iu.test(stderr)) {
      return new AzureDevOpsCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    if (/\b403\b|forbidden|insufficient_scope/iu.test(stderr)) {
      return new AzureDevOpsCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
      );
    }
    if (/\b404\b|not found|does not exist/iu.test(stderr)) {
      return new AzureDevOpsCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      );
    }
    return new AzureDevOpsCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
}

function parseRepoParts(fullName: string): {
  org?: string;
  project?: string;
  repo: string;
} {
  if (!REPOSITORY_PATH_PATTERN.test(fullName)) {
    throw new AzureDevOpsCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
    );
  }
  const parts = fullName.split("/");
  if (parts.length === 2) {
    return { project: parts[0], repo: parts[1] };
  }
  if (parts.length >= 3) {
    return {
      org: parts[0],
      project: parts[1],
      repo: parts.slice(2).join("/"),
    };
  }
  return { repo: fullName };
}

function validateRevision(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    throw new AzureDevOpsCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  return value;
}
