import { isRecord } from "@lcsp/contracts/shared";
import {
  decodeAzureDevOpsOrganizationPatCredential,
  GITHUB_CREDENTIAL_ERROR_CODES,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";
import type {
  GitHubIdentity,
  GitHubArchiveStream,
  GitHubRepositoryMetadata,
  GitHubRepositoryPagePolicy,
  GitHubRepositoryProviderPort,
  GitHubRepositorySummary,
  GitHubResolvedCommit,
} from "../../application/ports/github-repository-provider.port.js";
import type { CredentialLease } from "../../application/security/credential-lease.js";
import { AzureDevOpsSecureArchiveHttpTransport } from "./azure-devops-secure-archive-http.transport.js";

const API_VERSION = "7.1";
const API_HOST = "dev.azure.com";
const GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA = /^[0-9a-f]{40}$/iu;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

export class AzureDevOpsRestProviderError extends Error {
  constructor(
    readonly category: GitHubCredentialErrorCode,
    readonly status?: number,
  ) {
    super(category);
    this.name = "AzureDevOpsRestProviderError";
  }
}

export type AzureDevOpsRestProviderOptions = {
  timeoutMs: number;
  maxArchiveBytes: number;
  fetchImpl?: typeof fetch;
  archiveTransport?: AzureDevOpsSecureArchiveHttpTransport;
};
type AzureDevOpsRepositoryMetadata = GitHubRepositoryMetadata & {
  project: string;
};

/** Native Azure DevOps Services Git REST adapter; PAT identity is scoped to one organization. */
export class AzureDevOpsRestRepositoryProvider implements GitHubRepositoryProviderPort {
  private readonly fetchImpl: typeof fetch;
  private readonly archiveTransport: AzureDevOpsSecureArchiveHttpTransport;

  constructor(private readonly options: AzureDevOpsRestProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.archiveTransport =
      options.archiveTransport ??
      new AzureDevOpsSecureArchiveHttpTransport({
        timeoutMs: options.timeoutMs,
        maxArchiveBytes: options.maxArchiveBytes,
        fetchImpl: this.fetchImpl,
      });
  }

  /**
   * Business purpose: Validate that an organization-scoped PAT can access Azure DevOps Git resources.
   * Business rules: The typed credential's organization is the authorization scope; API access does not establish the PAT holder's human identity.
   * Execution flow: Decode the typed PAT, list the organization's repositories, and return a canonical organization locator.
   * Failure cases: Invalid credentials, inaccessible organizations, malformed provider responses, or timeout fail with a stable category.
   * Side effects: Performs bounded read-only HTTPS requests; credential material is never logged or returned.
   */
  async validateIdentity(credential: CredentialLease): Promise<GitHubIdentity> {
    const secret = this.decodeLease(credential);
    const response = await this.requestJson(
      credential,
      secret.organization,
      "_apis/git/repositories?$top=1",
    );
    if (!Array.isArray(response.value)) throw this.invalid();
    return {
      id: organizationIdentity(secret.organization),
      login: secret.organization,
      htmlUrl: `https://dev.azure.com/${encodeURIComponent(secret.organization)}`,
    };
  }

  /**
   * Business purpose: Discover readable repositories within the PAT's bound Azure organization.
   * Business rules: Results are constrained by caller page/repository budgets and repository GUIDs are the stable identities.
   * Execution flow: Page the organization Git repository endpoint, validate each record, and return canonical organization/project/name locators.
   * Failure cases: Malformed pages, foreign organization URLs, duplicate identity conflicts, or exceeded budgets fail closed.
   * Side effects: Performs bounded read-only HTTPS requests and returns metadata only.
   */
  async listAccessibleRepositories(
    credential: CredentialLease,
    policy: GitHubRepositoryPagePolicy,
  ): Promise<GitHubRepositorySummary[]> {
    const secret = this.decodeLease(credential);
    const maxPages = bounded(policy.maxPages, 1, 100);
    const maxRepositories = bounded(policy.maxRepositories, 1, 1000);
    const pageSize = bounded(policy.perPage, 1, 1000);
    if (!maxPages || !maxRepositories || !pageSize) throw this.invalid();
    const results = new Map<string, GitHubRepositorySummary>();
    let token: string | undefined;
    for (
      let page = 0;
      page < maxPages && results.size < maxRepositories;
      page += 1
    ) {
      const query = new URLSearchParams({
        $top: String(pageSize),
        "api-version": API_VERSION,
      });
      if (token) query.set("continuationToken", token);
      const { body, continuationToken } = await this.requestJsonWithHeaders(
        credential,
        secret.organization,
        `_apis/git/repositories?${query.toString()}`,
      );
      if (!Array.isArray(body.value)) throw this.invalid();
      for (const row of body.value) {
        const summary = this.repositorySummary(row, secret.organization);
        const prior = results.get(summary.id);
        if (prior && prior.fullName !== summary.fullName) throw this.invalid();
        results.set(summary.id, summary);
        if (results.size >= maxRepositories) break;
      }
      token = continuationToken;
      if (!token) break;
      if (page === maxPages - 1 && results.size < maxRepositories)
        throw this.invalid();
    }
    return [...results.values()];
  }

  /**
   * Business purpose: Confirm access to exactly one organization/project/repository tuple.
   * Business rules: Names are locators only; the provider response's repository GUID and organization-scoped remote URL establish identity.
   * Execution flow: Parse the full locator, find exact case-insensitive organization/project/name matches, and reject zero or multiple matches.
   * Failure cases: Cross-organization, missing, ambiguous, or inconsistent repository metadata is rejected.
   * Side effects: Performs bounded read-only HTTPS requests.
   */
  async validateRepositoryAccess(
    credential: CredentialLease,
    repositoryFullName: string,
  ): Promise<AzureDevOpsRepositoryMetadata> {
    const secret = this.decodeLease(credential);
    const locator = parseRepositoryFullName(repositoryFullName);
    if (
      !locator ||
      normalize(locator.organization) !== normalize(secret.organization)
    )
      throw this.accessDenied();
    const candidates = await this.listAllRepositories(
      credential,
      secret.organization,
    );
    const matches = candidates.filter(
      (repo) =>
        normalize(repo.project) === normalize(locator.project) &&
        normalize(repo.name) === normalize(locator.repository),
    );
    if (matches.length !== 1)
      throw matches.length ? this.invalid() : this.accessDenied();
    const result = matches[0];
    if (
      !GUID.test(result.id) ||
      result.fullName !==
        `${secret.organization}/${result.project}/${result.name}`
    )
      throw this.invalid();
    return result;
  }

  /**
   * Business purpose: Resolve a selected Azure branch, tag, default branch, or SHA to one verified immutable commit.
   * Business rules: Repository GUID and organization are revalidated; branch/tag names must identify exactly one ref and annotated tags must have a peeled commit.
   * Execution flow: Validate repository identity, fetch bounded refs with tag peeling, select an exact ref, then confirm the target through the commit endpoint.
   * Failure cases: Missing, ambiguous, malformed, cross-repository, or non-commit revisions fail closed.
   * Side effects: Performs bounded read-only HTTPS requests and returns immutable snapshot metadata.
   */
  async resolveCommit(
    credential: CredentialLease,
    repositoryFullName: string,
    revision: string,
    expectedRepositoryId?: string,
  ): Promise<GitHubResolvedCommit> {
    const secret = this.decodeLease(credential);
    const repository = await this.validateRepositoryAccess(
      credential,
      repositoryFullName,
    );
    if (
      expectedRepositoryId &&
      repository.id.toLowerCase() !== expectedRepositoryId.toLowerCase()
    )
      throw this.accessDenied();
    let sha: string;
    if (SHA.test(revision)) {
      sha = revision.toLowerCase();
    } else {
      if (!revision || revision.length > 256 || hasControlCharacters(revision))
        throw this.invalid();
      const refs = await this.listRefs(
        credential,
        secret.organization,
        repository.id,
      );
      const isExplicitBranch = revision.startsWith("refs/heads/");
      const isExplicitTag = revision.startsWith("refs/tags/");
      const branchMatches = refs.filter(
        (ref) =>
          ref.name === (isExplicitBranch ? revision : `refs/heads/${revision}`),
      );
      const tagMatches = refs.filter(
        (ref) =>
          ref.name === (isExplicitTag ? revision : `refs/tags/${revision}`),
      );
      if (
        (isExplicitBranch && branchMatches.length !== 1) ||
        (isExplicitTag && tagMatches.length !== 1) ||
        (!isExplicitBranch &&
          !isExplicitTag &&
          branchMatches.length + tagMatches.length !== 1)
      ) {
        throw this.invalid();
      }
      const ref = branchMatches[0] ?? tagMatches[0];
      sha =
        tagMatches.length && ref.peeledObjectId
          ? ref.peeledObjectId
          : ref.objectId;
      if (!SHA.test(sha)) throw this.invalid();
      sha = sha.toLowerCase();
    }
    const commit = await this.requestJson(
      credential,
      secret.organization,
      `_apis/git/repositories/${encodeURIComponent(repository.id)}/commits/${encodeURIComponent(sha)}?api-version=${API_VERSION}`,
      "GET",
      repository.project,
    );
    if (
      typeof commit.commitId !== "string" ||
      commit.commitId.toLowerCase() !== sha
    )
      throw this.invalid();
    const committer = isRecord(commit.committer) ? commit.committer : null;
    const date =
      committer && typeof committer.date === "string"
        ? validDate(committer.date)
        : null;
    return {
      sha,
      repositoryFullName: repository.fullName,
      htmlUrl: `https://dev.azure.com/${encodeURIComponent(secret.organization)}/${encodeURIComponent(repository.project)}/_git/${encodeURIComponent(repository.name)}/commit/${sha}`,
      authorDate: date,
      committerDate: date,
    };
  }

  /**
   * Business purpose: Retrieve a ZIP for the exact authorized Azure repository GUID and immutable commit.
   * Business rules: Organization, repository GUID, commit SHA, and PAT organization must match before transport is invoked.
   * Execution flow: Revalidate repository GUID, verify the commit, then request the archive using the pinned SHA and caller cancellation signal.
   * Failure cases: Identity mismatch, invalid SHA, archive transport failure, or provider rejection returns a bounded provider error.
   * Side effects: Performs one bounded source archive download; the returned stream is consumed by the shared snapshot pipeline.
   */
  async downloadArchive(
    credential: CredentialLease,
    repositoryFullName: string,
    commitSha: string,
    abortSignal?: AbortSignal,
    expectedRepositoryId?: string,
  ): Promise<GitHubArchiveStream> {
    const repository = await this.validateRepositoryAccess(
      credential,
      repositoryFullName,
    );
    if (
      !SHA.test(commitSha) ||
      (expectedRepositoryId &&
        repository.id.toLowerCase() !== expectedRepositoryId.toLowerCase())
    )
      throw this.accessDenied();
    await this.resolveCommit(
      credential,
      repository.fullName,
      commitSha,
      repository.id,
    );
    const archive = await this.archiveTransport.downloadArchive({
      credentialLease: credential,
      repositoryId: repository.id,
      repositoryFullName: repository.fullName,
      commitSha: commitSha.toLowerCase(),
      abortSignal,
    });
    return {
      stream: archive.stream,
      contentType: archive.contentType,
      repositoryFullName: repository.fullName,
      commitSha: commitSha.toLowerCase(),
      finalRedirectHostValidation: archive.redirectValidation,
      archiveRoot: archive.archiveRoot,
    };
  }

  private async listAllRepositories(
    credential: CredentialLease,
    organization: string,
  ) {
    const result: AzureDevOpsRepositoryMetadata[] = [];
    let token: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({
        $top: "1000",
        "api-version": API_VERSION,
      });
      if (token) query.set("continuationToken", token);
      const response = await this.requestJsonWithHeaders(
        credential,
        organization,
        `_apis/git/repositories?${query.toString()}`,
      );
      if (!Array.isArray(response.body.value)) throw this.invalid();
      for (const row of response.body.value)
        result.push(this.repositorySummary(row, organization));
      token = response.continuationToken;
      if (!token) return result;
    }
    throw this.invalid();
  }

  private repositorySummary(
    value: unknown,
    organization: string,
  ): AzureDevOpsRepositoryMetadata {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !GUID.test(value.id) ||
      typeof value.name !== "string" ||
      !safeName(value.name) ||
      !isRecord(value.project) ||
      typeof value.project.name !== "string" ||
      !safeName(value.project.name) ||
      typeof value.defaultBranch !== "string" ||
      !value.defaultBranch.startsWith("refs/heads/") ||
      typeof value.remoteUrl !== "string"
    )
      throw this.invalid();
    const remote = new URL(value.remoteUrl);
    const legacyHost = `${organization.toLowerCase()}.visualstudio.com`;
    if (
      remote.protocol !== "https:" ||
      (remote.hostname !== API_HOST &&
        remote.hostname.toLowerCase() !== legacyHost) ||
      (remote.username &&
        normalize(remote.username) !== normalize(organization)) ||
      remote.password ||
      remote.port ||
      remote.search ||
      remote.hash
    )
      throw this.invalid();
    const segments = remote.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const modernPathMatches =
      segments.length === 4 &&
      normalize(segments[0]) === normalize(organization) &&
      normalize(segments[1]) === normalize(value.project.name) &&
      segments[2] === "_git" &&
      normalize(segments[3]) === normalize(value.name);
    const modernCollectionPathMatches =
      remote.hostname === API_HOST &&
      segments.length === 3 &&
      normalize(segments[0]) === normalize(organization) &&
      segments[1] === "_git" &&
      normalize(segments[2]) === normalize(value.name);
    const legacyPathMatches =
      remote.hostname.toLowerCase() === legacyHost &&
      segments.length === 3 &&
      normalize(segments[0]) === normalize(value.project.name) &&
      segments[1] === "_git" &&
      normalize(segments[2]) === normalize(value.name);
    if (
      !modernPathMatches &&
      !modernCollectionPathMatches &&
      !legacyPathMatches
    )
      throw this.invalid();
    return {
      id: value.id.toLowerCase(),
      name: value.name,
      fullName: `${organization}/${value.project.name}/${value.name}`,
      defaultBranch: value.defaultBranch,
      private: value.project.visibility !== "public",
      project: value.project.name,
    };
  }

  private async listRefs(
    credential: CredentialLease,
    organization: string,
    repoId: string,
  ) {
    const refs: { name: string; objectId: string; peeledObjectId?: string }[] =
      [];
    let token: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({
        $top: "1000",
        peelTags: "true",
        "api-version": API_VERSION,
      });
      if (token) query.set("continuationToken", token);
      const response = await this.requestJsonWithHeaders(
        credential,
        organization,
        `_apis/git/repositories/${encodeURIComponent(repoId)}/refs?${query.toString()}`,
      );
      if (!Array.isArray(response.body.value)) throw this.invalid();
      for (const row of response.body.value) {
        if (
          !isRecord(row) ||
          typeof row.name !== "string" ||
          typeof row.objectId !== "string" ||
          !SHA.test(row.objectId) ||
          (row.peeledObjectId !== undefined &&
            (typeof row.peeledObjectId !== "string" ||
              !SHA.test(row.peeledObjectId)))
        )
          throw this.invalid();
        refs.push({
          name: row.name,
          objectId: row.objectId,
          ...(typeof row.peeledObjectId === "string"
            ? { peeledObjectId: row.peeledObjectId }
            : {}),
        });
      }
      token = response.continuationToken;
      if (!token) return refs;
    }
    throw this.invalid();
  }

  private async requestJson(
    credential: CredentialLease,
    organization: string,
    path: string,
    method = "GET",
    project?: string,
  ) {
    return (
      await this.requestJsonWithHeaders(
        credential,
        organization,
        path,
        method,
        project,
      )
    ).body;
  }

  private async requestJsonWithHeaders(
    credential: CredentialLease,
    organization: string,
    path: string,
    method = "GET",
    project?: string,
  ) {
    const org = this.decodeLease(credential).organization;
    if (normalize(org) !== normalize(organization)) throw this.accessDenied();
    const prefix = project
      ? `${encodeURIComponent(org)}/${encodeURIComponent(project)}`
      : encodeURIComponent(org);
    const url = new URL(
      `${prefix}/${path.replace(/^\//u, "")}`,
      `https://${API_HOST}/`,
    );
    if (
      url.hostname !== API_HOST ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    )
      throw this.invalid();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      const decoded = this.decodeLease(credential);
      response = await this.fetchImpl(url, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`:${decoded.pat}`).toString("base64")}`,
          Accept: "application/json",
          "User-Agent": "LCSP-Repository-Integration",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status))
        throw this.invalid(response.status);
      if (response.status === 401)
        throw new AzureDevOpsRestProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
          response.status,
        );
      if (response.status === 403)
        throw new AzureDevOpsRestProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
          response.status,
        );
      if (response.status === 429)
        throw new AzureDevOpsRestProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited,
          response.status,
        );
      if (!response.ok)
        throw new AzureDevOpsRestProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
          response.status,
        );
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_JSON_BYTES) throw this.invalid(response.status);
      const text = await readBounded(
        response,
        MAX_JSON_BYTES,
        controller.signal,
      );
      let body: unknown;
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw this.invalid(response.status);
      }
      if (!isRecord(body)) throw this.invalid(response.status);
      const continuationToken =
        response.headers.get("x-ms-continuationtoken") ?? undefined;
      if (
        continuationToken &&
        (continuationToken.length > 2048 || /[\r\n]/u.test(continuationToken))
      )
        throw this.invalid();
      return { body, continuationToken };
    } catch (error) {
      if (error instanceof AzureDevOpsRestProviderError) throw error;
      if (controller.signal.aborted)
        throw new AzureDevOpsRestProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
        );
      throw new AzureDevOpsRestProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private decodeLease(credential: CredentialLease) {
    try {
      return credential.withSecret((secret) =>
        decodeAzureDevOpsOrganizationPatCredential(secret),
      );
    } catch {
      throw new AzureDevOpsRestProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
  }

  private invalid(status?: number) {
    return new AzureDevOpsRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      status,
    );
  }
  private accessDenied() {
    return new AzureDevOpsRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
    );
  }
}

function organizationIdentity(organization: string): string {
  return `azure-organization:${organization.toLowerCase()}`;
}
function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US");
}
/**
 * Business purpose: Keep provider-returned names safe for canonical identity paths.
 * Business rules: Names are bounded and cannot contain separators, control characters, or traversal components.
 * Execution flow: Check length and path-safe character constraints.
 * Failure cases: Return false for names that cannot be represented unambiguously.
 * Side effects: Pure validation.
 */
function safeName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !hasControlCharacters(value)
  );
}

/**
 * Business purpose: Reject control characters before provider values enter identity, URL, or error boundaries.
 * Business rules: C0 controls and DEL are never accepted in organization, project, repository, or revision values.
 * Execution flow: Inspect each Unicode code point against the control ranges.
 * Failure cases: Return true when any forbidden code point is present.
 * Side effects: Pure validation.
 */
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
function bounded(value: number, min: number, max: number): number | null {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}
function parseRepositoryFullName(value: string) {
  const parts = value.split("/");
  return parts.length === 3 && parts.every(safeName)
    ? { organization: parts[0], project: parts[1], repository: parts[2] }
    : null;
}
function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readBounded(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body)
    throw new AzureDevOpsRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    if (signal.aborted) {
      await reader.cancel();
      throw new AzureDevOpsRestProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
      );
    }
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AzureDevOpsRestProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw new AzureDevOpsRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
}
