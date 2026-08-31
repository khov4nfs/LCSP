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
