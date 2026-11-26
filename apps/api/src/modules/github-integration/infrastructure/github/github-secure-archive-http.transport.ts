import { Readable, Transform } from "node:stream";

import { Injectable } from "@nestjs/common";
import {
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES,
  GITHUB_CREDENTIAL_ERROR_CODES,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";

import type {
  GitHubArchiveTransportPort,
  GitHubArchiveTransportResult,
} from "../../application/ports/github-archive-transport.port.js";
import type { CredentialLease } from "../../application/security/credential-lease.js";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REDIRECTS = 3;
const ALLOWED_ARCHIVE_HOSTS = new Set([
  "api.github.com",
  "codeload.github.com",
  "github.com",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ARCHIVE_CONTENT_TYPES = new Set([
  "application/gzip",
  "application/x-gzip",
  "application/octet-stream",
]);

export type GitHubArchiveHttpTransportConfig = {
  timeoutMs: number;
  maxArchiveBytes: number;
};

export type GitHubArchiveFetch = typeof fetch;

/** Stable secret-free failure from the direct GitHub archive transport. */
export class GitHubArchiveTransportError extends Error {
  constructor(
    readonly code:
      | GitHubCredentialErrorCode
      | (typeof GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES)[keyof typeof GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES],
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = "GitHubArchiveTransportError";
  }
}

/** Downloads exact-SHA GitHub archives while validating every redirect before following it. */
@Injectable()
export class GitHubSecureArchiveHttpTransport implements GitHubArchiveTransportPort {
  constructor(
    private readonly config: GitHubArchiveHttpTransportConfig,
    private readonly fetchImplementation: GitHubArchiveFetch = globalThis.fetch,
  ) {}

  /**
   * Business purpose: Deliver the exact pinned GitHub archive and its provider-generated wrapper identity.
   * Business rules: Archive retrieval is bound to the validated owner/repository and immutable commit; only approved HTTPS redirects and a matching codeload response filename establish the wrapper.
   * Execution flow: 1. Validate repository and SHA. 2. Request GitHub's archive endpoint and validate each redirect. 3. Validate response metadata and wrapper identity. 4. Stream bounded bytes with timeout and cancellation cleanup.
   * Failure cases: Unsafe redirects, invalid archive metadata, mismatched wrapper identity, provider errors, timeout, or cancellation reject before usable bytes are delivered.
   * Side effects: Performs read-only HTTPS requests and streams provider bytes; credentials and signed redirect data are not logged.
   */
  async downloadArchive(input: {
    credentialLease: CredentialLease;
    repositoryFullName: string;
    commitSha: string;
    abortSignal?: AbortSignal;
  }): Promise<GitHubArchiveTransportResult> {
    validateRepositoryFullName(input.repositoryFullName);
    if (!/^[0-9a-f]{40}$/iu.test(input.commitSha)) {
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(),
      this.config.timeoutMs,
    );
    const signal = input.abortSignal
      ? AbortSignal.any([input.abortSignal, timeoutController.signal])
      : timeoutController.signal;
    let currentUrl = new URL(
      `${GITHUB_API_BASE_URL}/repos/${input.repositoryFullName}/tarball/${input.commitSha}`,
    );
    let redirectCount = 0;
    let streamOwnsTimeout = false;

    try {
      while (true) {
        const isInitialRequest = redirectCount === 0;
        const headers: Record<string, string> = {
          accept: "application/vnd.github+json",
          "user-agent": "lcsp-api",
          "x-github-api-version": GITHUB_API_VERSION,
        };
        if (isInitialRequest) {
          input.credentialLease.withSecret((secret) => {
            headers.authorization = `Bearer ${secret}`;
          });
        }

        const response = await this.fetchImplementation(currentUrl, {
          method: "GET",
          headers,
          redirect: "manual",
          signal,
          credentials: "omit",
        });

        if (REDIRECT_STATUSES.has(response.status)) {
          if (redirectCount >= MAX_REDIRECTS) {
            await discardBody(response);
            throw new GitHubArchiveTransportError(
              GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.tooManyRedirects,
            );
          }
          const location = response.headers.get("location");
          await discardBody(response);
          const nextUrl = parseApprovedRedirect(location, currentUrl);
          currentUrl = nextUrl;
          redirectCount += 1;
          continue;
        }

        if (!response.ok || !response.body) {
          await discardBody(response);
          throw mapHttpFailure(response);
        }
        if (redirectCount === 0) {
          await discardBody(response);
          throw new GitHubArchiveTransportError(
            GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
          );
        }

        const contentType = normalizeContentType(
          response.headers.get("content-type"),
        );
        if (!ARCHIVE_CONTENT_TYPES.has(contentType)) {
          await discardBody(response);
          throw new GitHubArchiveTransportError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        }
        const contentLength = response.headers.get("content-length");
        if (contentLength !== null) {
          const parsedContentLength = Number(contentLength);
          if (
            !Number.isSafeInteger(parsedContentLength) ||
            parsedContentLength < 0
          ) {
            await discardBody(response);
            throw new GitHubArchiveTransportError(
              GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
            );
          }
          if (parsedContentLength > this.config.maxArchiveBytes) {
            await discardBody(response);
            throw new GitHubArchiveTransportError(
              GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.archiveTooLarge,
            );
          }
        }

        let archiveRoot: string;
        try {
          const [owner = "", repository = ""] =
            input.repositoryFullName.split("/");
          archiveRoot = parsePinnedArchiveRoot(
            response.headers.get("content-disposition"),
            owner,
            repository,
            input.commitSha,
          );
        } catch (error: unknown) {
          await discardBody(response);
          throw error;
        }

        const stream = Readable.fromWeb(response.body).pipe(
          createArchiveByteLimit(this.config.maxArchiveBytes),
        );
        streamOwnsTimeout = true;
        const cleanupTimeout = (): void => clearTimeout(timeout);
        stream.once("end", cleanupTimeout);
        stream.once("close", cleanupTimeout);
        stream.once("error", cleanupTimeout);
        return {
          stream,
          contentType,
          archiveRoot,
          redirectValidation:
            GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
          validatedHost: currentUrl.hostname,
        };
      }
    } catch (error: unknown) {
      if (error instanceof GitHubArchiveTransportError) throw error;
      if (input.abortSignal?.aborted) {
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled,
        );
      }
      if (timeoutController.signal.aborted) {
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
        );
      }
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    } finally {
      if (!streamOwnsTimeout) clearTimeout(timeout);
    }
  }
}

/**
 * Business purpose: Remove the exact GitHub-generated wrapper from repository-relative source paths.
 * Business rules: Only a codeload response filename tied to the requested owner, repository, and immutable SHA prefix establishes the wrapper; missing or contradictory metadata is rejected.
 * Execution flow: 1. Require one safe attachment filename. 2. Require the owner and repository prefix. 3. Verify the filename SHA fragment is a prefix of the pinned commit. 4. Return the exact filename stem.
 * Failure cases: Missing, ambiguous, path-like, or mismatched response metadata raises a provider-response error before archive delivery.
 * Side effects: Pure metadata validation; does not alter or disclose archive contents.
 */
function parsePinnedArchiveRoot(
  contentDisposition: string | null,
  owner: string,
  repository: string,
  commitSha: string,
): string {
  if (
    !contentDisposition ||
    contentDisposition.length > 512 ||
    /[\r\n]/u.test(contentDisposition) ||
    [...contentDisposition].some((character) => {
      const codePoint = character.charCodeAt(0);
      return codePoint < 32 || codePoint === 127;
    }) ||
    /(?:^|;)\s*filename\*\s*=/iu.test(contentDisposition)
  ) {
    throw new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  const segments = contentDisposition.split(";");
  const filenameMatches = [
    ...contentDisposition.matchAll(
      /(?:^|;)\s*filename\s*=\s*(?:"([^"\\]*)"|([^;\s]*))\s*(?=;|$)/giu,
    ),
  ];
  if (
    segments[0]?.trim().toLowerCase() !== "attachment" ||
    filenameMatches.length !== 1
  ) {
    throw new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  const filename = filenameMatches[0]?.[1] ?? filenameMatches[0]?.[2] ?? "";
  if (
    !filename.toLowerCase().endsWith(".tar.gz") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes(":")
  ) {
    throw new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  const archiveRoot = filename.slice(0, -7);
  const expectedPrefix = `${owner}-${repository}-`;
  const shaPrefix = archiveRoot.slice(expectedPrefix.length);
  if (
    archiveRoot.length > 255 ||
    !archiveRoot.toLowerCase().startsWith(expectedPrefix.toLowerCase()) ||
    shaPrefix.length < 7 ||
    shaPrefix.length > commitSha.length ||
    !commitSha.toLowerCase().startsWith(shaPrefix.toLowerCase())
  ) {
    throw new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
  return archiveRoot;
}

function parseApprovedRedirect(location: string | null, baseUrl: URL): URL {
  if (!location) {
    throw new GitHubArchiveTransportError(
      GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
    );
  }
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(location, baseUrl);
  } catch {
    throw new GitHubArchiveTransportError(
      GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
    );
  }
  if (
    redirectUrl.protocol !== "https:" ||
    !ALLOWED_ARCHIVE_HOSTS.has(redirectUrl.hostname)
  ) {
    throw new GitHubArchiveTransportError(
      GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
    );
  }
  return redirectUrl;
}

function validateRepositoryFullName(value: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    );
  }
}

function normalizeContentType(value: string | null): string {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function mapHttpFailure(response: Response): GitHubArchiveTransportError {
  const { status } = response;
  if (status === 401) {
    return new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      status,
    );
  }
  if (status === 403) {
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      return new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited,
        status,
      );
    }
    if (
      response.headers.get("x-github-sso")?.toLowerCase().includes("required")
    ) {
      return new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialApprovalRequired,
        status,
      );
    }
    return new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
      status,
    );
  }
  if (status === 404) {
    return new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      status,
    );
  }
  if (status === 429) {
    return new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited,
      status,
    );
  }
  if (status >= 500) {
    return new GitHubArchiveTransportError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      status,
    );
  }
  return new GitHubArchiveTransportError(
    GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
    status,
  );
}

function createArchiveByteLimit(maxBytes: number): Transform {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) {
        callback(
          new GitHubArchiveTransportError(
            GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.archiveTooLarge,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Deliberately discard provider response details.
  }
}
