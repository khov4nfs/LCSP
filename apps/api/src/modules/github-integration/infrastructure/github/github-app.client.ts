import { Readable } from "node:stream";
import { createSign } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const GITHUB_APP_INSTALL_BASE_URL = "https://github.com/apps";
const GITHUB_APP_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE_URL = "https://api.github.com";
const ALLOWED_ARCHIVE_HOSTS = new Set([
  "api.github.com",
  "codeload.github.com",
  "github.com",
]);

/**
 * Represents a sanitized GitHub App client failure and optional upstream HTTP status.
 */
export class GitHubAppClientError extends Error {
  /**
   * Creates a typed GitHub client error.
   *
   * @param message - Stable internal failure code/message safe for server diagnostics.
   * @param status - Optional upstream GitHub HTTP status associated with the failure.
   */
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface GitHubAppInstallationMetadata {
  permissions: Record<string, string>;
  repositories: GitHubRepositoryMetadata[];
  repository: GitHubRepositoryMetadata;
}

export interface GitHubRepositoryMetadata {
  id: string;
  name: string;
  fullName: string;
  defaultBranch: string;
}

type GitHubRepositoryApiResponse = {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  default_branch?: unknown;
};

type GitHubUserInstallationApiResponse = {
  id?: unknown;
  permissions?: unknown;
};

export interface GitHubResolvedCommit {
  sha: string;
  repositoryFullName: string;
  htmlUrl: string;
  authorDate: string | null;
  committerDate: string | null;
}

export interface GitHubRepositoryArchiveDownload {
  stream: Readable;
  contentType: string;
  resolvedUrl: string;
}

/**
 * Encapsulates GitHub App OAuth, installation-token, repository metadata, commit resolution, and archive-download HTTP calls.
 */
@Injectable()
export class GitHubAppClient {
  /**
   * Creates the GitHub client with application credentials and URL configuration access.
   *
   * @param configService - Configuration service used to resolve GitHub App slug, client credentials, app ID, and private key.
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * Builds the GitHub App installation URL carrying the opaque state and validated redirect URI.
   *
   * @param input - Installation state and callback redirect URI.
   * @returns Absolute GitHub App installation URL.
   */
  buildInstallationUrl(input: { state: string; redirectUri: string }): string {
    const appSlug = this.configService.get<string>("github.appSlug", "");
    const url = new URL(
      `${GITHUB_APP_INSTALL_BASE_URL}/${appSlug}/installations/new`,
    );
    url.searchParams.set("state", input.state);
    url.searchParams.set("redirect_uri", input.redirectUri);
    return url.toString();
  }

  /**
   * Exchanges the GitHub callback authorization code for a user access token used to inspect installations.
   *
   * @param code - GitHub OAuth callback code.
   * @returns Access token returned by GitHub.
   * @throws When the token endpoint is unreachable, rejects the request, or returns no usable token.
   */
  async exchangeCodeForAccessToken(code: string): Promise<string> {
    const clientId = this.configService.get<string>("github.clientId", "");
    const clientSecret = this.configService.get<string>(
      "github.clientSecret",
      "",
    );

    let response: Response;
    try {
      response = await fetch(GITHUB_APP_TOKEN_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });
    } catch {
      throw new GitHubAppClientError("github_app_token_exchange_unreachable");
    }

    if (!response.ok) {
      throw new GitHubAppClientError("github_app_token_exchange_failed");
    }

    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
    } | null;

    if (!body || typeof body.access_token !== "string" || !body.access_token) {
      throw new GitHubAppClientError("github_app_token_exchange_failed");
    }

    return body.access_token;
  }

  /**
   * Loads the selected installation's permissions and repository inventory using the user access token from the callback flow.
   *
   * @param input - Installation ID, user access token, and optional repository selection.
   * @returns Normalized installation permissions, all visible repositories, and the selected/first repository.
   * @throws When the installation or repository selection cannot be resolved.
   */
  async fetchInstallationMetadata(input: {
    installationId: string;
    accessToken: string;
    repositoryId?: string;
  }): Promise<GitHubAppInstallationMetadata> {
    const installations = await this.getJson<{
      installations?: GitHubUserInstallationApiResponse[];
    }>(
      `${GITHUB_API_BASE_URL}/user/installations?per_page=100`,
      input.accessToken,
    );
    const installation = installations?.installations?.find(
      (candidate) => String(candidate.id) === input.installationId,
    );

    if (
      !installation ||
      typeof installation.permissions !== "object" ||
      installation.permissions === null
    ) {
      throw new GitHubAppClientError("github_app_installation_fetch_failed");
    }

    const repositories = await this.getJson<{
      repositories?: GitHubRepositoryApiResponse[];
    }>(
      `${GITHUB_API_BASE_URL}/user/installations/${input.installationId}/repositories`,
      input.accessToken,
    );

    const repositoryOptions =
      repositories?.repositories
        ?.map(toRepositoryMetadata)
        .filter((repository): repository is GitHubRepositoryMetadata =>
          Boolean(repository),
        ) ?? [];
    const repository = input.repositoryId
      ? repositoryOptions.find(
          (candidate) => candidate.id === input.repositoryId,
        )
      : repositoryOptions[0];

    if (repositoryOptions.length === 0 || !repository) {
      throw new GitHubAppClientError("github_app_repository_selection_failed");
    }

    return {
      permissions: normalizePermissionRecord(installation.permissions),
      repositories: repositoryOptions,
      repository,
    };
  }

  /**
   * Resolves a branch/ref/SHA through an installation token and validates that GitHub returned a commit for the expected repository.
   *
   * @param input - Installation ID, owner-qualified repository name, and requested revision.
   * @returns Exact commit SHA plus repository and commit metadata.
   * @throws When installation authentication or commit resolution/shape validation fails.
   */
  async resolveCommit(input: {
    installationId: string;
    repositoryFullName: string;
    revision: string;
  }): Promise<GitHubResolvedCommit> {
    const accessToken = await this.createInstallationAccessToken(
      input.installationId,
    );
    const commit = await this.getJson<{
      sha?: unknown;
      url?: unknown;
      html_url?: unknown;
      commit?: {
        author?: { date?: unknown };
        committer?: { date?: unknown };
      };
    }>(
      `${GITHUB_API_BASE_URL}/repos/${input.repositoryFullName}/commits/${encodeURIComponent(input.revision)}`,
      accessToken,
    );
    const expectedApiPrefix = `${GITHUB_API_BASE_URL}/repos/${input.repositoryFullName}/commits/`;
    const expectedHtmlPrefix = `https://github.com/${input.repositoryFullName}/commit/`;

    if (
      !commit ||
      typeof commit.sha !== "string" ||
      !/^[0-9a-f]{40}$/i.test(commit.sha) ||
      typeof commit.url !== "string" ||
      !commit.url.startsWith(expectedApiPrefix) ||
      typeof commit.html_url !== "string" ||
      !commit.html_url.startsWith(expectedHtmlPrefix)
    ) {
      throw new GitHubAppClientError("github_commit_resolution_failed");
    }

    return {
      sha: commit.sha.toLowerCase(),
      repositoryFullName: input.repositoryFullName,
      htmlUrl: commit.html_url,
      authorDate: optionalString(commit.commit?.author?.date),
      committerDate: optionalString(commit.commit?.committer?.date),
    };
  }

  /**
   * Downloads the tarball for an exact pinned commit and rejects redirects to hosts outside the GitHub archive allowlist.
   *
   * @param input - Installation ID, owner-qualified repository name, and immutable commit SHA.
   * @returns Node-readable archive stream with response content type and final resolved URL.
   * @throws When GitHub is unreachable, rejects the archive request, returns no body, or redirects to an untrusted host.
   */
  async downloadRepositoryArchive(input: {
    installationId: string;
    repositoryFullName: string;
    commitSha: string;
  }): Promise<GitHubRepositoryArchiveDownload> {
    const accessToken = await this.createInstallationAccessToken(
      input.installationId,
    );

    let response: Response;
    try {
      response = await fetch(
        `${GITHUB_API_BASE_URL}/repos/${input.repositoryFullName}/tarball/${input.commitSha}`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "lcsp-api",
          },
        },
      );
    } catch {
      throw new GitHubAppClientError("github_repository_archive_unreachable");
    }

    if (!response.ok || !response.body) {
      throw new GitHubAppClientError(
        "github_repository_archive_failed",
        response.status,
      );
    }

    const resolvedUrl = new URL(response.url);
    if (!this.isArchiveHostAllowed(resolvedUrl.hostname)) {
      throw new GitHubAppClientError(
        "github_repository_archive_redirect_rejected",
      );
    }

    return {
      stream: Readable.fromWeb(
        response.body as globalThis.ReadableStream<Uint8Array>,
      ),
      contentType: response.headers.get("content-type") ?? "application/gzip",
      resolvedUrl: response.url,
    };
  }

  /**
   * Creates a short-lived GitHub installation access token using an App JWT.
   *
   * @param installationId - GitHub App installation identifier to authenticate as.
   * @returns Installation access token.
   * @throws When the GitHub API call fails or returns no token.
   */
  private async createInstallationAccessToken(
    installationId: string,
  ): Promise<string> {
    const body = await this.postJson<{ token?: unknown }>(
      `${GITHUB_API_BASE_URL}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      this.createAppJwt(),
    );
    if (!body || typeof body.token !== "string" || !body.token) {
      throw new GitHubAppClientError(
        "github_installation_token_creation_failed",
      );
    }
    return body.token;
  }

  /**
   * Creates the RS256 GitHub App JWT used to request installation access tokens.
   *
   * @returns Signed GitHub App JWT with a short validity window.
   * @throws When App credentials are missing or the configured private key cannot sign the token.
   */
  private createAppJwt(): string {
    const appId = this.configService.get<string>("github.appId", "");
    const privateKey = this.configService
      .get<string>("github.privateKey", "")
      .replace(/\\n/g, "\n");
    if (!appId || !privateKey) {
      throw new GitHubAppClientError("github_app_credentials_missing");
    }

    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    const header = encodeJwtPart({ alg: "RS256", typ: "JWT" });
    const payload = encodeJwtPart({
      iat: issuedAt,
      exp: issuedAt + 600,
      iss: appId,
    });
    const unsignedToken = `${header}.${payload}`;

    try {
      const signer = createSign("RSA-SHA256");
      signer.update(unsignedToken);
      signer.end();
      return `${unsignedToken}.${signer.sign(privateKey, "base64url")}`;
    } catch {
      throw new GitHubAppClientError("github_app_credentials_invalid");
    }
  }

  /**
   * Performs an authenticated GitHub GET and parses the JSON response.
   *
   * @param url - Absolute GitHub API URL to request.
   * @param accessToken - Bearer token authorizing the request.
   * @returns Parsed JSON body, or null when the successful response body is not valid JSON.
   * @throws When GitHub is unreachable or returns a non-success status.
   */
  private async getJson<T>(
    url: string,
    accessToken: string,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2026-03-10",
          "user-agent": "lcsp-api",
        },
      });
    } catch {
      throw new GitHubAppClientError("github_app_metadata_fetch_unreachable");
    }

    if (!response.ok) {
      throw new GitHubAppClientError(
        "github_app_metadata_fetch_failed",
        response.status,
      );
    }

    return (await response.json().catch(() => null)) as T | null;
  }

  /**
   * Performs an authenticated GitHub POST and parses the JSON response.
   *
   * @param url - Absolute GitHub API URL to request.
   * @param bearerToken - App or installation bearer token authorizing the request.
   * @returns Parsed JSON body, or null when the successful response body is not valid JSON.
   * @throws When GitHub is unreachable or returns a non-success status.
   */
  private async postJson<T>(
    url: string,
    bearerToken: string,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearerToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "lcsp-api",
        },
      });
    } catch {
      throw new GitHubAppClientError("github_app_api_unreachable");
    }

    if (!response.ok) {
      throw new GitHubAppClientError(
        "github_app_api_request_failed",
        response.status,
      );
    }
    return (await response.json().catch(() => null)) as T | null;
  }

  /**
   * Checks the final repository archive host against the explicit GitHub allowlist.
   *
   * @param hostname - Final response hostname after redirects.
   * @returns True when archive content is hosted on an approved GitHub domain.
   */
  private isArchiveHostAllowed(hostname: string): boolean {
    return ALLOWED_ARCHIVE_HOSTS.has(hostname);
  }
}

/**
 * Encodes a JWT header or payload object as URL-safe Base64 JSON.
 *
 * @param value - JWT object to serialize.
 * @returns Base64url-encoded JSON component.
 */
function encodeJwtPart(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Reads an optional string field without coercing other runtime types.
 *
 * @param value - Unknown value to inspect.
 * @returns String value, or null for non-string input.
 */
function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Normalizes GitHub permission values to uppercase contract values while retaining permission keys.
 *
 * @param value - Raw permission object returned by GitHub.
 * @returns Normalized permission record.
 */
function normalizePermissionRecord(value: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, permission]) => [
      key,
      typeof permission === "string" ? permission.toUpperCase() : "",
    ]),
  );
}

/**
 * Validates and converts a raw GitHub repository response into the minimal repository metadata used by the domain.
 *
 * @param repository - Raw repository object returned by the GitHub API.
 * @returns Normalized repository metadata, or null when required fields have unexpected types.
 */
function toRepositoryMetadata(
  repository: GitHubRepositoryApiResponse,
): GitHubRepositoryMetadata | null {
  return typeof repository.id === "number" &&
    typeof repository.name === "string" &&
    typeof repository.full_name === "string" &&
    typeof repository.default_branch === "string"
    ? {
        id: String(repository.id),
        name: repository.name,
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
      }
    : null;
}
