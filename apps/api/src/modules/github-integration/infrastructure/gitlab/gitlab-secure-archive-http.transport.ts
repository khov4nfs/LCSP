import { Readable } from "node:stream";

import {
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_CREDENTIAL_ERROR_CODES,
} from "@lcsp/contracts/github-integration";

import type {
  GitHubArchiveTransportPort,
  GitHubArchiveTransportResult,
} from "../../application/ports/github-archive-transport.port.js";
import type { CredentialLease } from "../../application/security/credential-lease.js";
import { GitHubArchiveTransportError } from "../github/github-secure-archive-http.transport.js";

const ALLOWED_HOSTS = new Set(["gitlab.com"]);
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const PROJECT_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/u;
const ARCHIVE_CONTENT_TYPES = new Set([
  "application/gzip",
  "application/x-gzip",
  "application/octet-stream",
]);

export class GitLabSecureArchiveHttpTransport implements GitHubArchiveTransportPort {
  constructor(
    private readonly options: { timeoutMs: number; maxArchiveBytes: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async downloadArchive(input: {
    credentialLease: CredentialLease;
    repositoryId?: string;
    repositoryFullName: string;
    commitSha: string;
    abortSignal?: AbortSignal;
  }): Promise<GitHubArchiveTransportResult> {
    if (
      !PROJECT_PATTERN.test(input.repositoryFullName) ||
      !SHA_PATTERN.test(input.commitSha)
    ) {
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const abort = () => controller.abort();
    input.abortSignal?.addEventListener("abort", abort, { once: true });
    let streamOwnsTimeout = false;
    try {
      const projectIdentifier =
        input.repositoryId && /^\d+$/u.test(input.repositoryId)
          ? input.repositoryId
          : encodeURIComponent(input.repositoryFullName);
      let url = `https://gitlab.com/api/v4/projects/${projectIdentifier}/repository/archive.tar.gz?sha=${input.commitSha}`;
      let response: Response;
      for (let redirects = 0; ; redirects += 1) {
        const headers: Record<string, string> = {};
        if (redirects === 0) {
          input.credentialLease.withSecret((token) => {
            headers["PRIVATE-TOKEN"] = token;
          });
        }
        response = await this.fetchImpl(url, {
          method: "GET",
          headers,
          mode: "same-origin",
          redirect: "manual",
          signal: controller.signal,
          credentials: "omit",
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        if (redirects >= 3)
          throw new GitHubArchiveTransportError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        const location = response.headers.get("location");
        if (!location)
          throw new GitHubArchiveTransportError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        const next = new URL(location, url);
        if (next.protocol !== "https:" || !ALLOWED_HOSTS.has(next.hostname)) {
          throw new GitHubArchiveTransportError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        }
        url = next.toString();
      }
      if (response.status === 401)
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
          response.status,
        );
      if (response.status === 403)
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
          response.status,
        );
      if (!response.ok)
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
          response.status,
        );
      if (!response.body)
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          response.status,
        );
      const contentType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!ARCHIVE_CONTENT_TYPES.has(contentType))
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      if (
        response.headers.get("content-length") &&
        Number(response.headers.get("content-length")) >
          this.options.maxArchiveBytes
      ) {
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      }
      const source = Readable.fromWeb(response.body as never);
      let bytes = 0;
      const stream = source.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > this.options.maxArchiveBytes)
          source.destroy(
            new GitHubArchiveTransportError(
              GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
            ),
          );
      });
      streamOwnsTimeout = true;
      const cleanup = () => {
        clearTimeout(timer);
        input.abortSignal?.removeEventListener("abort", abort);
      };
      stream.once("end", cleanup);
      stream.once("close", cleanup);
      stream.once("error", cleanup);
      return {
        stream,
        contentType,
        redirectValidation:
          GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
        validatedHost: "gitlab.com",
      };
    } catch (error) {
      if (error instanceof GitHubArchiveTransportError) throw error;
      if (input.abortSignal?.aborted)
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled,
        );
      if (controller.signal.aborted)
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
        );
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    } finally {
      if (!streamOwnsTimeout) {
        clearTimeout(timer);
        input.abortSignal?.removeEventListener("abort", abort);
      }
    }
  }
}
