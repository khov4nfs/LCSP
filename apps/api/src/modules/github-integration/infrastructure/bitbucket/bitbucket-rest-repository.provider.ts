import { isRecord } from "@lcsp/contracts/shared";
import {
  decodeBitbucketApiTokenCredential,
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
import type { CredentialLease } from "../../application/security/credential-lease.js";
import { BitbucketSecureArchiveHttpTransport } from "./bitbucket-secure-archive-http.transport.js";

const API_ROOT = "https://api.bitbucket.org/2.0/";
const API_HOST = "api.bitbucket.org";
const USER_AGENT = "LCSP-Repository-Integration";
const PROVIDER_UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const MAX_REVISION_LENGTH = 256;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PAGE_LENGTH = 100;

export type BitbucketRestRepositoryProviderOptions = {
  timeoutMs: number;
  maxArchiveBytes: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
  archiveTransport?: BitbucketSecureArchiveHttpTransport;
};

/** Stable provider error with no raw response, URL, or credential data. */
export class BitbucketRestProviderError extends Error {
  constructor(
    readonly category: GitHubCredentialErrorCode,
    readonly status?: number,
  ) {
    super(category);
    this.name = "BitbucketRestProviderError";
  }
}

type BitbucketCredential = ReturnType<typeof decodeBitbucketApiTokenCredential>;

/** Native Bitbucket Cloud REST implementation. App Password and CLI secrets are not accepted. */
export class BitbucketRestRepositoryProvider implements GitHubRepositoryProviderPort {
  private readonly fetchImpl: typeof fetch;
  private readonly archiveTransport: BitbucketSecureArchiveHttpTransport;

  constructor(
    private readonly options: BitbucketRestRepositoryProviderOptions,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.archiveTransport =
      options.archiveTransport ??
      new BitbucketSecureArchiveHttpTransport(
        {
          timeoutMs: options.timeoutMs,
          maxArchiveBytes: options.maxArchiveBytes,
        },
        this.fetchImpl,
      );
  }

  /**
   * Business purpose: Validate the submitted Atlassian user API Token and identify its account.
   * Business rules: Only the typed email/API Token envelope is accepted and only the official Bitbucket Cloud identity endpoint is queried.
   * Execution flow: 1. Decode the typed secret. 2. Call `/user` with Basic auth. 3. Return the provider UUID and stable public profile fields.
   * Failure cases: Invalid envelope, rejected credentials, unavailable provider, or malformed identity responses fail with bounded provider categories.
   * Side effects: Performs one read-only HTTPS request; no credential or response payload is logged or persisted here.
   */
  async validateIdentity(credential: CredentialLease): Promise<GitHubIdentity> {
    const body = await this.requestJson(credential, "user");
    const id = typeof body.uuid === "string" ? body.uuid : undefined;
    const login =
      typeof body.username === "string"
        ? body.username
        : typeof body.nickname === "string"
          ? body.nickname
          : undefined;
    if (!id || !isProviderUuid(id) || !login) {
      throw this.invalid();
    }
    return {
      id,
      login,
      htmlUrl: `https://bitbucket.org/${encodeURIComponent(login)}`,
    };
  }

  /**
   * Business purpose: Return repositories the authenticated user can read across their workspaces.
   * Business rules: Workspaces and repositories are enumerated only within caller-supplied page and repository budgets.
   * Execution flow: 1. Page `/user/workspaces`. 2. Page each workspace repository collection. 3. Validate and deduplicate summaries until limits are reached.
   * Failure cases: Invalid pagination metadata, malformed records, rejected access, or provider failures stop discovery without returning unvalidated rows.
   * Side effects: Performs bounded read-only HTTPS requests and returns metadata only.
   */
  async listAccessibleRepositories(
    credential: CredentialLease,
    pagePolicy: GitHubRepositoryPagePolicy,
  ): Promise<GitHubRepositorySummary[]> {
    const maxPages = boundedInteger(pagePolicy.maxPages, 1, 100);
    const maxRepositories = boundedInteger(pagePolicy.maxRepositories, 1, 1000);
    const perPage = boundedInteger(pagePolicy.perPage, 1, MAX_PAGE_LENGTH);
    if (!maxPages || !maxRepositories || !perPage) throw this.invalid();

    const results = new Map<string, GitHubRepositorySummary>();
    const startPage =
      pagePolicy.startPage === undefined
        ? 1
        : boundedInteger(pagePolicy.startPage, 1, 10_000);
    if (!startPage) throw this.invalid();
    const workspaces = await this.collectPages(
      credential,
      `user/workspaces?pagelen=${perPage}${startPage > 1 ? `&page=${startPage}` : ""}`,
      maxPages,
      (row) => {
        if (
          !isRecord(row) ||
          typeof row.slug !== "string" ||
          !isSafeSlug(row.slug)
        ) {
          throw this.invalid();
        }
        return row.slug;
      },
    );
    let repositoryPages = 0;

    for (const workspace of workspaces.values) {
      if (results.size >= maxRepositories || repositoryPages >= maxPages) break;
      const remainingPages = maxPages - repositoryPages;
      const repositories = await this.collectPages(
        credential,
        `repositories/${encodeURIComponent(workspace)}?pagelen=${perPage}`,
        remainingPages,
        (row) => this.repositorySummary(row),
      );
      repositoryPages += repositories.pages;
      for (const repository of repositories.values) {
        results.set(repository.id, repository);
        if (results.size >= maxRepositories) break;
      }
    }
    return [...results.values()];
  }

  /**
   * Business purpose: Confirm that the typed credential can read the requested Bitbucket repository.
   * Business rules: The canonical workspace/repository locator must exactly match the provider's returned identity; an empty default branch is not synthesized.
   * Execution flow: 1. Validate the locator. 2. Fetch repository metadata. 3. Validate UUID, workspace, slug, name, privacy, and default branch fields.
   * Failure cases: Missing or contradictory repository metadata is rejected as unavailable or invalid provider data.
   * Side effects: Performs one read-only HTTPS request and returns repository metadata.
   */
  async validateRepositoryAccess(
    credential: CredentialLease,
    repositoryFullName: string,
    allowCanonicalRename = false,
  ): Promise<GitHubRepositoryMetadata> {
    const [workspace, repository] = splitRepositoryName(repositoryFullName);
    const body = await this.requestJson(
      credential,
      `repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}`,
    );
    const metadata = this.repositorySummary(body);
    const requested = `${workspace}/${repository}`;
    if (
      normalizeRepositoryName(metadata.fullName) !==
      normalizeRepositoryName(requested)
    ) {
      throw new BitbucketRestProviderError(
        allowCanonicalRename
          ? GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable
          : GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }
    return metadata;
  }

  /**
   * Business purpose: Resolve a selected branch, tag, or commit to one immutable Bitbucket commit.
   * Business rules: The connection's stable repository UUID is rechecked when supplied; SHA input must resolve to the same SHA, and a name shared by a branch and tag is rejected.
   * Execution flow: 1. Revalidate repository identity. 2. Verify a SHA directly or probe branch and tag refs. 3. Fetch the first commit for the unique ref and return its immutable hash.
   * Failure cases: Missing, ambiguous, mismatched, malformed, or inaccessible revisions fail closed.
   * Side effects: Performs bounded read-only HTTPS requests and does not mutate repository state.
   */
  async resolveCommit(
    credential: CredentialLease,
    repositoryFullName: string,
    revision: string,
    expectedRepositoryId?: string,
  ): Promise<GitHubResolvedCommit> {
    const repository = await this.validateRepositoryAccess(
      credential,
      repositoryFullName,
    );
    if (expectedRepositoryId && repository.id !== expectedRepositoryId) {
      throw new BitbucketRestProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      );
    }
    const selectedRevision = validateRevision(revision);
    if (!COMMIT_SHA_PATTERN.test(selectedRevision)) {
      const [workspace, slug] = splitRepositoryName(repository.fullName);
      const base = `repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/refs`;
      const [branch, tag] = await Promise.all([
        this.optionalRef(
          credential,
          `${base}/branches/${encodeURIComponent(selectedRevision)}`,
        ),
        this.optionalRef(
          credential,
          `${base}/tags/${encodeURIComponent(selectedRevision)}`,
        ),
      ]);
      if (branch && tag) throw this.invalid();
      if (!branch && !tag) {
        throw new BitbucketRestProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
        );
      }
    }

    const [workspace, slug] = splitRepositoryName(repository.fullName);
    const resolved = await this.requestJson(
      credential,
      `repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/commits/${encodeURIComponent(selectedRevision)}?pagelen=1`,
    );
    if (!Array.isArray(resolved.values) || resolved.values.length === 0) {
      throw new BitbucketRestProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      );
    }
    const commit = (resolved.values as unknown[])[0];
    if (
      !isRecord(commit) ||
      typeof commit.hash !== "string" ||
      !COMMIT_SHA_PATTERN.test(commit.hash)
    ) {
      throw this.invalid();
    }
    const sha = commit.hash.toLowerCase();
    if (
      COMMIT_SHA_PATTERN.test(selectedRevision) &&
      sha !== selectedRevision.toLowerCase()
    ) {
      throw this.invalid();
    }
    const date =
      typeof commit.date === "string" ? validDate(commit.date) : null;
    return {
      sha,
      repositoryFullName: repository.fullName,
      htmlUrl: `https://bitbucket.org/${workspace}/${slug}/commits/${sha}`,
      authorDate: date,
      committerDate: date,
    };
  }

  /**
   * Business purpose: Download ZIP bytes for one repository UUID and pinned commit.
   * Business rules: The transport verifies the immutable repository binding, uses Basic auth only for the trusted initial host, and never follows untrusted redirects.
   * Execution flow: 1. Validate the locator and SHA. 2. Delegate bounded ZIP retrieval. 3. Return the archive with pinned identity metadata.
   * Failure cases: Repository mismatch, invalid archive response, timeout, cancellation, or provider authorization failure is returned as a typed error.
   * Side effects: Performs a read-only HTTPS archive request and yields a bounded stream.
   */
  async downloadArchive(
    credential: CredentialLease,
    repositoryFullName: string,
    commitSha: string,
    abortSignal?: AbortSignal,
    expectedRepositoryId?: string,
  ): Promise<GitHubArchiveStream> {
    const [workspace, slug] = splitRepositoryName(repositoryFullName);
    const result = await this.archiveTransport.downloadArchive({
      credentialLease: credential,
      repositoryId: expectedRepositoryId,
      repositoryFullName: `${workspace}/${slug}`,
      commitSha,
      abortSignal,
    });
    return {
      stream: result.stream,
      contentType: result.contentType,
      repositoryFullName: `${workspace}/${slug}`,
      commitSha,
      finalRedirectHostValidation: result.redirectValidation,
      archiveRoot: result.archiveRoot,
    };
  }

  /**
   * Business purpose: Distinguish a missing branch/tag from other provider failures during ambiguity checks.
   * Business rules: Only a typed 404 means the ref is absent; authorization, timeout, and malformed-response errors remain fatal.
   * Execution flow: Request one exact ref and translate only 404 into null.
   * Failure cases: Every non-404 typed error propagates unchanged.
   * Side effects: Performs one bounded read-only request.
   */
  private async optionalRef(
    credential: CredentialLease,
    path: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await this.requestJson(credential, path);
    } catch (error: unknown) {
      if (error instanceof BitbucketRestProviderError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Business purpose: Normalize a Bitbucket repository response into the shared provider contract.
   * Business rules: The stable UUID, workspace/slug, display name, privacy flag, and actual default branch must be present and consistent.
   * Execution flow: Validate the JSON record and fields, then return the provider UUID and normalized repository locator.
   * Failure cases: Missing, synthetic, malformed, or contradictory provider metadata is rejected.
   * Side effects: Pure response validation.
   */
  private repositorySummary(value: unknown): GitHubRepositorySummary {
    if (!isRecord(value)) throw this.invalid();
    const id = typeof value.uuid === "string" ? value.uuid : undefined;
    const name = typeof value.name === "string" ? value.name : undefined;
    const fullName =
      typeof value.full_name === "string" ? value.full_name : undefined;
    const defaultBranch =
      isRecord(value.mainbranch) && typeof value.mainbranch.name === "string"
        ? value.mainbranch.name
        : undefined;
    const isPrivate =
      typeof value.is_private === "boolean" ? value.is_private : undefined;
    const split = fullName ? splitRepositoryName(fullName) : null;
    const slug = typeof value.slug === "string" ? value.slug : split?.[1];
    if (
      !id ||
      !isProviderUuid(id) ||
      !name ||
      containsControlCharacter(name) ||
      !split ||
      !fullName ||
      split[1] !== slug ||
      !defaultBranch ||
      isPrivate === undefined
    ) {
      throw this.invalid();
    }
    return { id, name, fullName, defaultBranch, private: isPrivate };
  }

  /**
   * Business purpose: Collect provider rows without exceeding caller-supplied pagination limits.
   * Business rules: Every continuation URL must remain on the official HTTPS Bitbucket REST host and within the API v2 path.
   * Execution flow: Request each page, validate and map each row, then follow bounded `next` links until exhausted or capped.
   * Failure cases: Malformed page records, unsafe continuation URLs, or provider errors abort the collection.
   * Side effects: Performs bounded read-only HTTPS requests.
   */
  private async collectPages<T>(
    credential: CredentialLease,
    firstPath: string,
    maxPages: number,
    mapValue: (value: unknown) => T,
  ): Promise<{ values: T[]; pages: number }> {
    const values: T[] = [];
    let path: string | null = firstPath;
    let pages = 0;
    while (path && pages < maxPages) {
      const body = await this.requestJson(credential, path);
      if (!Array.isArray(body.values)) throw this.invalid();
      values.push(...body.values.map(mapValue));
      pages += 1;
      if (body.next === undefined) {
        path = null;
      } else if (typeof body.next === "string") {
        path = validateNextPage(body.next);
      } else {
        throw this.invalid();
      }
    }
    return { values, pages };
  }

  /**
   * Business purpose: Execute one authenticated Bitbucket REST request and return a bounded JSON object.
   * Business rules: Basic authentication uses the typed user email/API Token; the host is fixed, redirects are rejected, response bytes are capped, and raw payloads are never exposed.
   * Execution flow: 1. Build an allowlisted URL. 2. Decode the typed lease secret and send a timed GET. 3. Map status, media type, size, and JSON validation to stable categories.
   * Failure cases: Authentication, authorization, rate-limit, timeout, network, malformed-media, and invalid-JSON failures remain typed and redacted.
   * Side effects: Performs one read-only HTTPS request and holds credential bytes only for the request header construction.
   */
  private async requestJson(
    credential: CredentialLease,
    pathOrUrl: string,
  ): Promise<Record<string, unknown>> {
    const url = makeApiUrl(pathOrUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const auth = credential.withSecret((secret) => {
        let typed: BitbucketCredential;
        try {
          typed = decodeBitbucketApiTokenCredential(secret);
        } catch {
          throw new BitbucketRestProviderError(
            GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
          );
        }
        return `Basic ${Buffer.from(`${typed.email}:${typed.apiToken}`, "utf8").toString("base64")}`;
      });
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: auth,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400)
        throw this.invalid(response.status);
      if (!response.ok) throw providerStatusError(response.status);
      if (!response.body) throw this.invalid(response.status);
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== "application/json")
        throw this.invalid(response.status);
      const advertisedSize = Number(response.headers.get("content-length"));
      const maxBytes = this.options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
      if (Number.isFinite(advertisedSize) && advertisedSize > maxBytes)
        throw this.invalid(response.status);
      const text = await readBoundedJson(
        response.body,
        maxBytes,
        controller.signal,
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw this.invalid(response.status);
      }
      if (!isRecord(parsed)) throw this.invalid(response.status);
      return parsed;
    } catch (error: unknown) {
      if (error instanceof BitbucketRestProviderError) throw error;
      if (controller.signal.aborted) {
        throw new BitbucketRestProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
        );
      }
      throw new BitbucketRestProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private invalid(status?: number): BitbucketRestProviderError {
    return new BitbucketRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      status,
    );
  }
}

/**
 * Business purpose: Prevent provider-controlled pagination data from selecting an arbitrary destination.
 * Business rules: API requests may target only HTTPS api.bitbucket.org paths under `/2.0/` without credentials or explicit ports.
 * Execution flow: Resolve a relative or absolute candidate and validate scheme, host, port, authority, and path prefix.
 * Failure cases: Unsafe URLs raise a bounded invalid-provider-response error.
 * Side effects: Pure URL validation.
 */
function makeApiUrl(pathOrUrl: string): string {
  const url = new URL(pathOrUrl, API_ROOT);
  if (
    url.protocol !== "https:" ||
    url.hostname !== API_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith("/2.0/")
  ) {
    throw new BitbucketRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  return url.toString();
}

/**
 * Business purpose: Constrain provider pagination to the fixed Bitbucket REST origin.
 * Business rules: Continuations must be bounded HTTPS URLs with no user information or non-default port and an API v2 path.
 * Execution flow: Parse the continuation and validate the allowlisted authority and path.
 * Failure cases: Malformed or foreign-host URLs fail closed.
 * Side effects: Pure URL validation.
 */
function validateNextPage(value: string): string {
  if (typeof value !== "string" || value.length > 2048) {
    throw new BitbucketRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== API_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith("/2.0/")
  ) {
    throw new BitbucketRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  return url.toString();
}

/**
 * Business purpose: Convert a Bitbucket workspace/repository locator into two safe REST path components.
 * Business rules: Exactly two provider slug components are accepted; names cannot inject path segments.
 * Execution flow: Split once by `/` and validate each component against the supported slug alphabet.
 * Failure cases: Invalid locators raise the stable repository-unavailable category.
 * Side effects: Pure parsing.
 */
function splitRepositoryName(value: string): [string, string] {
  const parts = value.split("/");
  if (parts.length !== 2 || parts.some((part) => !isSafeSlug(part))) {
    throw new BitbucketRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
    );
  }
  return [parts[0], parts[1]];
}

/**
 * Business purpose: Check one URL-safe Bitbucket slug component before REST path construction.
 * Business rules: Slugs begin with an alphanumeric character and contain only alphanumeric, dot, underscore, or hyphen characters.
 * Execution flow: Apply the bounded component expression.
 * Failure cases: Invalid values return false.
 * Side effects: Pure validation.
 */
function isSafeSlug(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

/**
 * Business purpose:
 * - Accept the exact UUID shape returned by Bitbucket while preserving the provider's original spelling.
 * Business rules:
 * - Bitbucket may wrap UUIDs in braces, but the UUID body must have canonical hyphen positions and hexadecimal digits.
 * Execution flow:
 * 1. Remove one balanced outer brace pair when present.
 * 2. Validate the remaining UUID against the fixed pattern.
 * Failure cases:
 * - Any malformed or mismatched brace form returns false.
 * Side effects:
 * - Pure validation with no identity normalization or persistence.
 */
function isProviderUuid(value: string): boolean {
  const unwrapped =
    value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  return PROVIDER_UUID_PATTERN.test(unwrapped);
}

/**
 * Business purpose: Compare Bitbucket workspace/repository slugs using provider-insensitive casing.
 * Business rules: Normalization applies only to validated ASCII slug components.
 * Execution flow: Validate and split the locator, then lowercase both components with a fixed locale.
 * Failure cases: Invalid locators raise repository-unavailable.
 * Side effects: Pure normalization.
 */
function normalizeRepositoryName(value: string): string {
  return splitRepositoryName(value).join("/").toLocaleLowerCase("en-US");
}

/**
 * Business purpose: Reject malformed or path-injecting branch, tag, and commit revision input.
 * Business rules: Revisions are bounded, non-empty, control-free, and contain no empty, dot, traversal, or backslash path components.
 * Execution flow: Validate the input's length and component syntax before URL encoding.
 * Failure cases: Invalid input raises providerResponseInvalid.
 * Side effects: Pure validation.
 */
function validateRevision(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REVISION_LENGTH ||
    containsControlCharacter(value) ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new BitbucketRestProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  return value;
}

/**
 * Business purpose: Preserve valid provider commit dates in normalized ISO form.
 * Business rules: Invalid or absent provider dates are represented as null rather than guessed.
 * Execution flow: Parse a timestamp and return ISO output only for a finite date.
 * Failure cases: Invalid timestamps return null.
 * Side effects: Pure conversion.
 */
/**
 * Business purpose: Reject control characters before provider values enter paths or public metadata.
 * Business rules: C0 controls and DEL are not valid in these bounded repository and revision fields.
 * Execution flow: Inspect each Unicode code point and reject values in the control ranges.
 * Failure cases: The caller receives a boolean and maps invalid values to its provider response category.
 * Side effects: Pure validation.
 */
function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function validDate(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Business purpose: Keep pagination limits within provider and application budgets.
 * Business rules: Only integer values inside the inclusive bounds are accepted.
 * Execution flow: Check integer and range constraints.
 * Failure cases: Out-of-range values return null so the operation can reject the request.
 * Side effects: Pure validation.
 */
function boundedInteger(
  value: number,
  min: number,
  max: number,
): number | null {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/**
 * Business purpose: Read provider JSON without allowing an unbounded response body into memory.
 * Business rules: Total bytes are capped and the caller's timeout signal is observed while consuming the stream.
 * Execution flow: Read chunks, reject over-budget data, concatenate only bounded bytes, then decode strict UTF-8.
 * Failure cases: Oversized, interrupted, or malformed UTF-8 content fails without returning partial JSON.
 * Side effects: Consumes the provider response stream and cancels an over-budget body.
 */
async function readBoundedJson(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("request_aborted");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BitbucketRestProviderError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Business purpose: Map Bitbucket HTTP statuses to stable shared provider categories.
 * Business rules: Credential invalidity is inferred only from 401; 403 remains authorization denial and rate-limit/timeout statuses retain their own categories.
 * Execution flow: Select a bounded category from the numeric status and create a redacted typed error.
 * Failure cases: Unknown client statuses map to invalid provider response.
 * Side effects: Pure classification.
 */
function providerStatusError(status: number): BitbucketRestProviderError {
  const category =
    status === 401
      ? GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid
      : status === 403
        ? GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied
        : status === 404
          ? GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable
          : status === 429
            ? GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited
            : status === 408 || status === 504
              ? GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout
              : status >= 500
                ? GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable
                : GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid;
  return new BitbucketRestProviderError(category, status);
}
