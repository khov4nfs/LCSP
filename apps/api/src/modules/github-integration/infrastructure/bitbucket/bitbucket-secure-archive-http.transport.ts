import { Readable } from "node:stream";

import {
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES,
  GITHUB_CREDENTIAL_ERROR_CODES,
  decodeBitbucketApiTokenCredential,
} from "@lcsp/contracts/github-integration";

import type {
  GitHubArchiveTransportPort,
  GitHubArchiveTransportResult,
} from "../../application/ports/github-archive-transport.port.js";
import type { CredentialLease } from "../../application/security/credential-lease.js";
import { GitHubArchiveTransportError } from "../github/github-secure-archive-http.transport.js";

const API_HOST = "api.bitbucket.org";
const ARCHIVE_HOST = "bitbucket.org";
const PROVIDER_UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const REPOSITORY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const ZIP_CONTENT_TYPES = new Set([
  "application/zip",
  "application/octet-stream",
  "application/x-zip-compressed",
]);

export class BitbucketSecureArchiveHttpTransport implements GitHubArchiveTransportPort {
  constructor(
    private readonly options: { timeoutMs: number; maxArchiveBytes: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Business purpose: Deliver the private Bitbucket ZIP for the connection's immutable repository and commit.
   * Business rules: HTTPS hosts are pinned, repository UUID is revalidated before retrieval, TLS remains enabled, and Basic credentials are sent only to the initial trusted host.
   * Execution flow: 1. Validate locator, UUID, and SHA. 2. Verify the repository UUID using the REST API. 3. Request the exact-SHA ZIP, validate redirects and media type, then stream bounded bytes after signature verification.
   * Failure cases: Invalid identity, unauthorized access, unsafe redirect, HTML/non-ZIP response, timeout, cancellation, truncation, or size overflow rejects the stream with a safe category.
   * Side effects: Performs read-only HTTPS requests and yields a bounded archive stream; credentials and response bodies are never logged.
   */
  async downloadArchive(input: {
    credentialLease: CredentialLease;
    repositoryId?: string;
    repositoryFullName: string;
    commitSha: string;
    abortSignal?: AbortSignal;
  }): Promise<GitHubArchiveTransportResult> {
    if (
      !REPOSITORY_PATTERN.test(input.repositoryFullName) ||
      !SHA_PATTERN.test(input.commitSha) ||
      !input.repositoryId ||
      !isProviderUuid(input.repositoryId)
    ) {
      throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
    }
    const [workspace, repository] = input.repositoryFullName.split("/");
    const auth = authorizationHeader(input.credentialLease);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const abort = () => controller.abort();
    input.abortSignal?.addEventListener("abort", abort, { once: true });
    let streamOwnsTimeout = false;
    try {
      await this.verifyRepositoryIdentity(
        workspace,
        repository,
        input.repositoryId,
        auth,
        controller.signal,
      );

      let url = `https://${ARCHIVE_HOST}/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/get/${input.commitSha}.zip`;
      let response: Response;
      for (let redirects = 0; ; redirects += 1) {
        const headers: Record<string, string> = {};
        if (redirects === 0) headers.Authorization = auth;
        response = await this.fetchImpl(url, {
          method: "GET",
          headers,
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        if (redirects >= 3)
          throw archiveError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        const location = response.headers.get("location");
        if (!location)
          throw archiveError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw archiveError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        }
        if (
          next.protocol !== "https:" ||
          next.hostname !== ARCHIVE_HOST ||
          next.port ||
          next.username ||
          next.password
        ) {
          throw archiveError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        }
        url = next.toString();
      }

      if (!response.ok) throw archiveStatusError(response.status);
      if (!response.body)
        throw archiveError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          response.status,
        );
      const contentType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!ZIP_CONTENT_TYPES.has(contentType)) {
        throw archiveError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          response.status,
        );
      }
      let archiveRoot: string;
      try {
        archiveRoot = parseVerifiedArchiveRoot(
          response.headers.get("content-disposition"),
          workspace,
          repository,
          input.commitSha,
        );
      } catch (error: unknown) {
        await response.body.cancel().catch(() => undefined);
        throw error;
      }
      const rawLength = response.headers.get("content-length");
      if (
        rawLength !== null &&
        (!/^\d+$/u.test(rawLength) ||
          Number(rawLength) > this.options.maxArchiveBytes)
      ) {
        throw archiveError(
          GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.archiveTooLarge,
        );
      }

      const stream = await createVerifiedZipStream(
        response.body,
        this.options.maxArchiveBytes,
        controller.signal,
      );
      streamOwnsTimeout = true;
      const cleanup = (): void => {
        clearTimeout(timer);
        input.abortSignal?.removeEventListener("abort", abort);
      };
      stream.once("end", cleanup);
      stream.once("close", cleanup);
      stream.once("error", cleanup);
      return {
        stream,
        contentType,
        archiveRoot,
        redirectValidation:
          GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
        validatedHost: ARCHIVE_HOST,
      };
    } catch (error: unknown) {
      if (error instanceof GitHubArchiveTransportError) throw error;
      if (input.abortSignal?.aborted) {
        throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled);
      }
      if (controller.signal.aborted) {
        throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout);
      }
      throw archiveError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    } finally {
      if (!streamOwnsTimeout) {
        clearTimeout(timer);
        input.abortSignal?.removeEventListener("abort", abort);
      }
    }
  }

  /**
   * Business purpose: Revalidate the stable Bitbucket repository UUID before archive bytes are obtained.
   * Business rules: The API request stays on api.bitbucket.org and both UUID and canonical workspace/slug must match the pinned connection.
   * Execution flow: Request repository metadata with Basic auth, enforce bounded JSON metadata, and compare exact identity fields.
   * Failure cases: Unauthorized, unavailable, malformed, or mismatched identity fails before archive retrieval.
   * Side effects: Performs one read-only HTTPS request and consumes its bounded response.
   */
  private async verifyRepositoryIdentity(
    workspace: string,
    repository: string,
    repositoryId: string,
    authorization: string,
    signal: AbortSignal,
  ): Promise<void> {
    const url = `https://${API_HOST}/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "manual",
      credentials: "omit",
      signal,
    });
    if (!response.ok) throw archiveStatusError(response.status);
    if (response.url && new URL(response.url).hostname !== API_HOST) {
      throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
    }
    const rawLength = response.headers.get("content-length");
    if (
      rawLength !== null &&
      (!/^\d+$/u.test(rawLength) || Number(rawLength) > 64 * 1024)
    ) {
      throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
    }
    const text = await readBoundedText(response.body, 64 * 1024, signal);
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("uuid" in body) ||
      body.uuid !== repositoryId ||
      !("full_name" in body) ||
      body.full_name !== `${workspace}/${repository}`
    ) {
      throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable);
    }
  }
}

/**
 * Business purpose: Identify Bitbucket's generated ZIP wrapper without guessing from archive entry shape.
 * Business rules: Only the trusted Bitbucket response filename matching the workspace, repository slug, and pinned commit prefix establishes the exact wrapper; missing or contradictory metadata stays unknown and is rejected.
 * Execution flow: 1. Require one bounded attachment filename. 2. Validate it as a single ZIP basename. 3. Match the observed Bitbucket naming convention against the authorized repository and pinned SHA. 4. Return the exact filename stem used by the archive.
 * Failure cases: Missing, duplicate, malformed, path-like, or identity-mismatched filename metadata maps to an invalid provider response.
 * Side effects: Pure metadata validation; no archive bytes or credentials are logged or changed.
 */
function parseVerifiedArchiveRoot(
  contentDisposition: string | null,
  workspace: string,
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
    })
  ) {
    throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
  }
  const segments = contentDisposition.split(";");
  if (segments[0]?.trim().toLowerCase() !== "attachment") {
    throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
  }
  if (/(?:^|;)\s*filename\*\s*=/iu.test(contentDisposition)) {
    throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
  }
  const filenameMatches = [
    ...contentDisposition.matchAll(
      /(?:^|;)\s*filename\s*=\s*(?:"([^"\\]*)"|([^;\s]*))\s*(?=;|$)/giu,
    ),
  ];
  if (filenameMatches.length !== 1) {
    throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
  }
  const filename = filenameMatches[0]?.[1] ?? filenameMatches[0]?.[2] ?? "";
  if (
    !filename.toLowerCase().endsWith(".zip") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes(":")
  ) {
    throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
  }
  const archiveRoot = filename.slice(0, -4);
  const expectedRoot = `${workspace}-${repository}-${commitSha.slice(0, 12)}`;
  if (
    archiveRoot.length === 0 ||
    archiveRoot.length > 255 ||
    archiveRoot.toLowerCase() !== expectedRoot.toLowerCase()
  ) {
    throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
  }
  return archiveRoot;
}

/**
 * Business purpose: Build the one approved Bitbucket authentication header from the encrypted credential lease.
 * Business rules: Only an explicit Atlassian API Token credential is accepted; no Bearer or App Password fallback occurs.
 * Execution flow: Decode the typed lease value and base64 encode account email plus API Token for Basic authentication.
 * Failure cases: Legacy or malformed secret values map to credentialInvalid without echoing secret data.
 * Side effects: Creates a transient authorization header and does not persist or log it.
 */
function authorizationHeader(lease: CredentialLease): string {
  return lease.withSecret((secret) => {
    let credential: ReturnType<typeof decodeBitbucketApiTokenCredential>;
    try {
      credential = decodeBitbucketApiTokenCredential(secret);
    } catch {
      throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid);
    }
    return `Basic ${Buffer.from(`${credential.email}:${credential.apiToken}`, "utf8").toString("base64")}`;
  });
}

/**
 * Business purpose:
 * - Validate the persisted Bitbucket repository UUID before using it as an archive authorization binding.
 * Business rules:
 * - A balanced optional brace pair is accepted around a canonical hexadecimal UUID.
 * Execution flow:
 * 1. Remove braces only when both are present.
 * 2. Validate UUID group lengths and separators.
 * Failure cases:
 * - Malformed identifiers cause archive retrieval to fail closed before network access.
 * Side effects:
 * - Pure validation.
 */
function isProviderUuid(value: string): boolean {
  const unwrapped =
    value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  return PROVIDER_UUID_PATTERN.test(unwrapped);
}

/**
 * Business purpose: Validate ZIP response bytes while preserving a bounded streaming archive pipeline.
 * Business rules: Only a local-file ZIP signature is accepted; total bytes cannot exceed the configured limit and unconsumed bodies are cancelled.
 * Execution flow: Read only enough initial bytes to verify the signature, then yield the prefix and remaining chunks through a bounded stream.
 * Failure cases: Empty, non-ZIP, oversized, cancelled, or truncated streams raise safe archive errors.
 * Side effects: Consumes and may cancel the provider response body while streaming bytes to the caller.
 */
async function createVerifiedZipStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Readable> {
  const reader = body.getReader();
  const initial: Buffer[] = [];
  let initialLength = 0;
  try {
    while (initialLength < 4) {
      const { done, value } = await reader.read();
      if (done)
        throw archiveError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      const chunk = Buffer.from(value);
      initial.push(chunk);
      initialLength += chunk.length;
      if (initialLength > maxBytes)
        throw archiveError(
          GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.archiveTooLarge,
        );
    }
    const prefix = Buffer.concat(initial);
    if (!prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
    }
    const stream = Readable.from(
      (async function* (): AsyncGenerator<Buffer> {
        let bytes = prefix.length;
        yield prefix;
        try {
          while (true) {
            if (signal.aborted)
              throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout);
            const { done, value } = await reader.read();
            if (done) return;
            const chunk = Buffer.from(value);
            bytes += chunk.length;
            if (bytes > maxBytes)
              throw archiveError(
                GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.archiveTooLarge,
              );
            yield chunk;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      })(),
    );
    return stream;
  } catch (error: unknown) {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    throw error;
  }
}

/**
 * Business purpose: Bound the repository identity response before parsing provider metadata.
 * Business rules: The response cannot exceed its metadata budget and strict UTF-8 decoding is required.
 * Execution flow: Consume chunks with an abort check, enforce the byte limit, and decode only after completion.
 * Failure cases: Missing, oversized, interrupted, or malformed JSON bytes are rejected.
 * Side effects: Consumes the response body.
 */
async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (!body)
    throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted)
        throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout);
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw archiveError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw archiveError(GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid);
  }
}

/**
 * Business purpose: Preserve meaningful Bitbucket archive HTTP failure categories.
 * Business rules: Only 401 identifies invalid credentials; 403 is access denial, 429 is rate limiting, and unknown statuses are not overclassified.
 * Execution flow: Map numeric status to the shared error category and construct a redacted archive error.
 * Failure cases: Unknown client status becomes invalid provider response.
 * Side effects: Pure classification.
 */
function archiveStatusError(status: number): GitHubArchiveTransportError {
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
  return archiveError(category, status);
}

/**
 * Business purpose: Construct a safe shared archive transport error.
 * Business rules: Only stable contract categories and optional HTTP status are retained; response body and secret values are excluded.
 * Execution flow: Instantiate the typed archive error with the classified category.
 * Failure cases: None beyond the requested safe category.
 * Side effects: Creates an in-memory error only.
 */
function archiveError(
  code:
    | (typeof GITHUB_CREDENTIAL_ERROR_CODES)[keyof typeof GITHUB_CREDENTIAL_ERROR_CODES]
    | (typeof GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES)[keyof typeof GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES],
  status?: number,
): GitHubArchiveTransportError {
  return new GitHubArchiveTransportError(code, status);
}
