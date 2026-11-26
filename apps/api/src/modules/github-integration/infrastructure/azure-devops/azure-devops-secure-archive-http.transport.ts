import { Readable, Transform } from "node:stream";
import { createHash } from "node:crypto";
import { isRecord } from "@lcsp/contracts/shared";
import {
  decodeAzureDevOpsOrganizationPatCredential,
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_CREDENTIAL_ERROR_CODES,
} from "@lcsp/contracts/github-integration";
import type {
  GitHubArchiveTransportPort,
  GitHubArchiveTransportResult,
  PinnedRepositoryTreeManifest,
} from "../../application/ports/github-archive-transport.port.js";
import type { CredentialLease } from "../../application/security/credential-lease.js";
import { GitHubArchiveTransportError } from "../github/github-secure-archive-http.transport.js";

const SHA = /^[0-9a-f]{40}$/iu;
const MAX_TREE_ENTRIES = 100_000;
const MAX_TREE_REQUESTS = 4_096;
const MAX_TREE_PATH_BYTES = 16 * 1024 * 1024;
const MAX_TREE_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_JSON_RESPONSE_BYTES = 1024 * 1024;

export type AzureDevOpsArchiveTransportOptions = {
  timeoutMs: number;
  maxArchiveBytes: number;
  fetchImpl?: typeof fetch;
};

/** Retrieves one organization-scoped Azure ZIP without forwarding PATs across redirects. */
export class AzureDevOpsSecureArchiveHttpTransport implements GitHubArchiveTransportPort {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: AzureDevOpsArchiveTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Business purpose: Stream source bytes for the exact Azure repository GUID and pinned commit.
   * Business rules: Only the typed organization PAT is accepted; host and repository identity are checked before sending Basic auth; redirects are rejected.
   * Execution flow: Parse the bound organization/project/repository, request the ZIP at the commit SHA, validate response metadata and ZIP signature, then enforce the byte budget while streaming.
   * Failure cases: Wrong identity, unsafe redirect, rejected credentials, invalid media, HTML response, oversize data, cancellation, and timeout fail without yielding a usable archive.
   * Side effects: Makes one bounded HTTPS source request and returns a disposable stream; it does not extract archives or log credential data.
   */
  async downloadArchive(input: {
    credentialLease: CredentialLease;
    repositoryId?: string;
    repositoryFullName: string;
    commitSha: string;
    abortSignal?: AbortSignal;
  }): Promise<GitHubArchiveTransportResult> {
    const secret = input.credentialLease.withSecret((value) => {
      try {
        return decodeAzureDevOpsOrganizationPatCredential(value);
      } catch {
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
        );
      }
    });
    const parts = input.repositoryFullName.split("/");
    if (
      parts.length !== 3 ||
      normalize(parts[0]) !== normalize(secret.organization) ||
      parts.some((part) => !safePathComponent(part)) ||
      !input.repositoryId ||
      !isGuid(input.repositoryId) ||
      !SHA.test(input.commitSha)
    ) {
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }
    const [organization, project, repositoryName] = parts;
    const query = new URLSearchParams({
      scopePath: "/",
      recursionLevel: "Full",
      "versionDescriptor.version": input.commitSha.toLowerCase(),
      "versionDescriptor.versionType": "commit",
      $format: "zip",
      "api-version": "7.1",
    });
    const url = new URL(
      `${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(input.repositoryId)}/items?${query.toString()}`,
      "https://dev.azure.com/",
    );
    if (
      url.hostname !== "dev.azure.com" ||
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password
    )
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const abort = () => controller.abort();
    input.abortSignal?.addEventListener("abort", abort, { once: true });
    let streamOwnsTimer = false;
    try {
      const repositoryUrl = new URL(
        `${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(input.repositoryId)}?api-version=7.1`,
        "https://dev.azure.com/",
      );
      const repositoryInfo = await this.requestJson(
        repositoryUrl,
        secret.pat,
        controller.signal,
      );
      if (
        typeof repositoryInfo.id !== "string" ||
        repositoryInfo.id.toLowerCase() !== input.repositoryId.toLowerCase() ||
        typeof repositoryInfo.name !== "string" ||
        normalize(repositoryInfo.name) !== normalize(repositoryName) ||
        !isRecord(repositoryInfo.project) ||
        typeof repositoryInfo.project.name !== "string" ||
        normalize(repositoryInfo.project.name) !== normalize(project)
      ) {
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      }
      const commitUrl = new URL(
        `${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(input.repositoryId)}/commits/${encodeURIComponent(input.commitSha.toLowerCase())}?api-version=7.1`,
        "https://dev.azure.com/",
      );
      const commit = await this.requestJson(
        commitUrl,
        secret.pat,
        controller.signal,
      );
      if (
        typeof commit.commitId !== "string" ||
        commit.commitId.toLowerCase() !== input.commitSha.toLowerCase() ||
        typeof commit.treeId !== "string" ||
        !SHA.test(commit.treeId)
      ) {
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      }
      const treeManifest = await this.getPinnedTreeManifest(
        organization,
        project,
        input.repositoryId,
        commit.treeId,
        input.commitSha,
        secret.pat,
        controller.signal,
      );
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        credentials: "omit",
        headers: {
          Authorization: `Basic ${Buffer.from(`:${secret.pat}`).toString("base64")}`,
          Accept: "application/zip, application/octet-stream",
          "User-Agent": "LCSP-Repository-Integration",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status))
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          response.status,
        );
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
      if (response.status === 429)
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited,
          response.status,
        );
      if (!response.ok || !response.body)
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
          response.status,
        );
      const contentType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (
        !new Set([
          "application/zip",
          "application/octet-stream",
          "application/x-zip-compressed",
        ]).has(contentType)
      )
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          response.status,
        );
      const lengthHeader = response.headers.get("content-length");
      if (
        lengthHeader !== null &&
        (!/^\d+$/u.test(lengthHeader) ||
          Number(lengthHeader) > this.options.maxArchiveBytes)
      )
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          response.status,
        );
      const source = Readable.fromWeb(response.body as never);
      let byteCount = 0;
      let signatureChecked = false;
      let signaturePrefix = Buffer.alloc(0);
      const maxArchiveBytes = this.options.maxArchiveBytes;
      const bounded = source.pipe(
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            byteCount += bytes.length;
            if (byteCount > maxArchiveBytes)
              return callback(
                new GitHubArchiveTransportError(
                  GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
                ),
              );
            if (!signatureChecked) {
              signaturePrefix = Buffer.concat([signaturePrefix, bytes]);
              if (signaturePrefix.length >= 4) {
                signatureChecked = true;
                if (!isZipSignature(signaturePrefix))
                  return callback(
                    new GitHubArchiveTransportError(
                      GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
                    ),
                  );
                this.push(signaturePrefix);
                signaturePrefix = Buffer.alloc(0);
                return callback();
              }
              return callback();
            }
            this.push(bytes);
            callback();
          },
          flush: (callback) => {
            if (!signatureChecked)
              return callback(
                new GitHubArchiveTransportError(
                  GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
                ),
              );
            callback();
          },
        }),
      );
      streamOwnsTimer = true;
      const cleanup = () => {
        clearTimeout(timer);
        input.abortSignal?.removeEventListener("abort", abort);
      };
      bounded.once("error", () => source.destroy());
      bounded.once("end", cleanup);
      bounded.once("close", cleanup);
      bounded.once("error", cleanup);
      return {
        stream: bounded,
        contentType,
        treeManifest,
        redirectValidation:
          GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
        validatedHost: "dev.azure.com",
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
      if (!streamOwnsTimer) {
        clearTimeout(timer);
        input.abortSignal?.removeEventListener("abort", abort);
      }
    }
  }

  /**
   * Business purpose: Verify the provider's repository or commit response before requesting source bytes.
   * Business rules: Only the fixed Azure DevOps HTTPS origin is queried, redirects are rejected, and JSON bodies remain bounded.
   * Execution flow: Send one Basic-authenticated GET, map safe status categories, cap and parse the JSON body.
   * Failure cases: Redirects, invalid credentials, denied access, rate limits, oversized or malformed responses fail closed.
   * Side effects: Performs one read-only provider request without exposing response details.
   */
  private async requestJson(
    url: URL,
    pat: string,
    signal: AbortSignal,
    maxResponseBytes = DEFAULT_JSON_RESPONSE_BYTES,
    allowTreeFallback = false,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal,
      credentials: "omit",
      headers: {
        Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
        Accept: "application/json",
        "User-Agent": "LCSP-Repository-Integration",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status))
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        response.status,
      );
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
    if (response.status === 429)
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited,
        response.status,
      );
    if (!response.ok)
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
        response.status,
      );
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const lengthHeader = response.headers.get("content-length");
    const length = lengthHeader === null ? 0 : Number(lengthHeader);
    if (
      contentType !== "application/json" ||
      (lengthHeader !== null &&
        (!/^\d+$/u.test(lengthHeader) || length > maxResponseBytes)) ||
      !response.body
    ) {
      if (
        allowTreeFallback &&
        lengthHeader !== null &&
        length > maxResponseBytes
      ) {
        await response.body?.cancel();
        throw new AzureTreeMetadataTooLargeError();
      }
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        response.status,
      );
    }
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      if (signal.aborted) {
        await reader.cancel();
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
        );
      }
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        if (allowTreeFallback) throw new AzureTreeMetadataTooLargeError();
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      }
      chunks.push(value);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ) as unknown;
    } catch {
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    }
    if (!isRecord(parsed))
      throw new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      );
    return parsed;
  }

  /**
   * Business purpose: Commit to the complete regular-file path set of the exact repository tree so the secure workspace can resolve ZIP rooting.
   * Business rules: The commit-provided tree ID must match the requested immutable commit; only complete, bounded Azure tree responses with safe unique paths are accepted.
   * Execution flow: 1. Request the recursive tree at the pinned tree ID. 2. If the response is explicitly truncated or exceeds the recursive budget, walk bounded non-recursive trees. 3. Validate every tree entry and hash the sorted exact blob paths.
   * Failure cases: Incomplete, contradictory, oversized, unsafe, duplicate, or unsupported tree metadata rejects archive delivery before ZIP retrieval.
   * Side effects: Performs bounded read-only Azure REST requests using the same credential lease secret and cancellation signal.
   */
  private async getPinnedTreeManifest(
    organization: string,
    project: string,
    repositoryId: string,
    treeId: string,
    commitSha: string,
    pat: string,
    signal: AbortSignal,
  ): Promise<PinnedRepositoryTreeManifest> {
    const recursiveUrl = this.treeUrl(
      organization,
      project,
      repositoryId,
      treeId,
      true,
    );
    let recursiveTree: Record<string, unknown> | undefined;
    try {
      recursiveTree = await this.requestJson(
        recursiveUrl,
        pat,
        signal,
        MAX_TREE_RESPONSE_BYTES,
        true,
      );
    } catch (error: unknown) {
      if (!(error instanceof AzureTreeMetadataTooLargeError)) throw error;
    }

    let entries: Array<{ path: string; mode: string; type: string }>;
    if (
      recursiveTree &&
      recursiveTree.truncated !== undefined &&
      typeof recursiveTree.truncated !== "boolean"
    ) {
      throw invalidTreeResponse();
    }
    if (
      recursiveTree &&
      recursiveTree.truncated !== true &&
      Array.isArray(recursiveTree.treeEntries) &&
      recursiveTree.treeEntries.length < MAX_TREE_ENTRIES
    ) {
      entries = validateTreeEntries(recursiveTree.treeEntries, true);
      const pathBytes = entries.reduce(
        (total, entry) => total + Buffer.byteLength(entry.path, "utf8"),
        0,
      );
      if (
        typeof recursiveTree.objectId !== "string" ||
        recursiveTree.objectId.toLowerCase() !== treeId.toLowerCase() ||
        pathBytes > MAX_TREE_PATH_BYTES
      ) {
        throw invalidTreeResponse();
      }
    } else {
      entries = await this.walkPinnedTree(
        organization,
        project,
        repositoryId,
        treeId,
        pat,
        signal,
      );
    }
    return createPathManifest(entries, commitSha, treeId);
  }

  /**
   * Business purpose: Recover a complete pinned Azure repository tree when the recursive endpoint exceeds its bounded response.
   * Business rules: Every tree object must match the requested ID, paths must be safe and unique, and entry, path-byte, and request limits apply to the entire traversal.
   * Execution flow: 1. Start at the commit's verified root tree ID. 2. Request each child tree without recursion. 3. Accumulate exact paths and enqueue verified tree objects until no work remains.
   * Failure cases: Missing or mismatched tree IDs, malformed entries, duplicate paths, incomplete responses, cancellation, or exceeded limits reject the manifest.
   * Side effects: Performs bounded read-only REST calls with the current credential lease; does not modify repository state.
   */
  private async walkPinnedTree(
    organization: string,
    project: string,
    repositoryId: string,
    rootTreeId: string,
    pat: string,
    signal: AbortSignal,
  ): Promise<Array<{ path: string; mode: string; type: string }>> {
    const pending: Array<{ treeId: string; prefix: string }> = [
      { treeId: rootTreeId, prefix: "" },
    ];
    const entries: Array<{ path: string; mode: string; type: string }> = [];
    const seenPaths = new Set<string>();
    let totalPathBytes = 0;
    let requests = 0;
    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) throw invalidTreeResponse();
      requests += 1;
      if (requests > MAX_TREE_REQUESTS) throw invalidTreeResponse();
      const tree = await this.requestJson(
        this.treeUrl(
          organization,
          project,
          repositoryId,
          current.treeId,
          false,
        ),
        pat,
        signal,
      );
      if (
        typeof tree.objectId !== "string" ||
        tree.objectId.toLowerCase() !== current.treeId.toLowerCase() ||
        tree.truncated === true ||
        (tree.truncated !== undefined && typeof tree.truncated !== "boolean") ||
        !Array.isArray(tree.treeEntries)
      ) {
        throw invalidTreeResponse();
      }
      for (const rawEntry of tree.treeEntries) {
        const [entry] = validateTreeEntries([rawEntry], false);
        const path = current.prefix
          ? `${current.prefix}/${entry.path}`
          : entry.path;
        totalPathBytes += Buffer.byteLength(path, "utf8");
        if (
          totalPathBytes > MAX_TREE_PATH_BYTES ||
          seenPaths.has(path) ||
          seenPaths.size >= MAX_TREE_ENTRIES
        ) {
          throw invalidTreeResponse();
        }
        seenPaths.add(path);
        if (entry.type === "tree") {
          const objectId = isRecord(rawEntry) ? rawEntry.objectId : undefined;
          if (typeof objectId !== "string" || !SHA.test(objectId)) {
            throw invalidTreeResponse();
          }
          pending.push({ treeId: objectId, prefix: path });
        } else {
          entries.push({ ...entry, path });
        }
      }
    }
    return entries;
  }

  private treeUrl(
    organization: string,
    project: string,
    repositoryId: string,
    treeId: string,
    recursive: boolean,
  ): URL {
    const url = new URL(
      `${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/trees/${encodeURIComponent(treeId)}`,
      "https://dev.azure.com/",
    );
    url.searchParams.set("api-version", "7.1");
    if (recursive) url.searchParams.set("recursive", "true");
    return url;
  }
}

class AzureTreeMetadataTooLargeError extends Error {}

/**
 * Business purpose: Accept only Azure Git tree entries that can safely contribute to immutable archive-root verification.
 * Business rules: Each entry must have a valid object ID, a supported Git mode/type pair, a unique safe exact path, and the expected recursive shape.
 * Execution flow: 1. Validate each response object. 2. Check path and mode/type invariants. 3. Return normalized metadata without rewriting any path.
 * Failure cases: Missing fields, duplicate or ambiguous paths, unsupported object types, and invalid modes reject the provider response.
 * Side effects: Pure response validation; it does not issue requests or change provider data.
 */
function validateTreeEntries(
  values: unknown[],
  recursive: boolean,
): Array<{ path: string; mode: string; type: string }> {
  const result: Array<{ path: string; mode: string; type: string }> = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!isRecord(value)) throw invalidTreeResponse();
    const path = value.relativePath;
    const mode = value.mode;
    const type = value.gitObjectType;
    const objectId = value.objectId;
    if (
      typeof path !== "string" ||
      typeof mode !== "string" ||
      typeof type !== "string" ||
      typeof objectId !== "string" ||
      !SHA.test(objectId) ||
      !isSafeTreePath(path, recursive) ||
      seen.has(path)
    ) {
      throw invalidTreeResponse();
    }
    if (!(
      (type === "tree" && (mode === "40000" || mode === "040000")) ||
      (type === "blob" && ["100644", "100755", "120000"].includes(mode)) ||
      (type === "commit" && mode === "160000")
    )) {
      throw invalidTreeResponse();
    }
    seen.add(path);
    result.push({ path, mode, type });
  }
  return result;
}

/**
 * Business purpose: Prevent Azure tree paths from creating ambiguous or unsafe repository-relative archive identities.
 * Business rules: Paths are exact slash-delimited Git paths and cannot contain roots, backslashes, controls, empty segments, or traversal segments.
 * Execution flow: 1. Validate the raw string and length. 2. Split without normalization. 3. Enforce the expected single-entry or recursive path shape.
 * Failure cases: Any unsafe or contradictory path returns false and causes the containing tree response to fail closed.
 * Side effects: Pure validation; it does not normalize or access the filesystem.
 */
function isSafeTreePath(path: string, recursive: boolean): boolean {
  if (
    !path ||
    path.length > 4096 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    hasControlCharacters(path)
  ) {
    return false;
  }
  const segments = path.split("/");
  return (
    (recursive || segments.length === 1) &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    )
  );
}

/**
 * Business purpose: Bind Azure archive-root resolution to the complete blob path set at one verified commit tree.
 * Business rules: Only exact Git blob paths are committed; paths are sorted by UTF-8 bytes and length-prefixed before hashing.
 * Execution flow: 1. Select and sort blob paths. 2. Enforce aggregate bounds and uniqueness. 3. Return the commit/tree identity and deterministic digest.
 * Failure cases: Duplicate, oversized, or excessive paths reject archive verification before source bytes are delivered.
 * Side effects: Pure digest construction; it does not persist or retrieve repository source.
 */
function createPathManifest(
  entries: Array<{ path: string; mode: string; type: string }>,
  commitSha: string,
  treeId: string,
): PinnedRepositoryTreeManifest {
  const paths = entries
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    );
  if (paths.length > MAX_TREE_ENTRIES) throw invalidTreeResponse();
  const unique = new Set(paths);
  if (unique.size !== paths.length) throw invalidTreeResponse();
  const totalBytes = paths.reduce(
    (total, path) => total + Buffer.byteLength(path, "utf8"),
    0,
  );
  if (totalBytes > MAX_TREE_PATH_BYTES) throw invalidTreeResponse();
  const hash = createHash("sha256");
  for (const path of paths) {
    const bytes = Buffer.from(path, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length).update(bytes);
  }
  return {
    version: 1,
    commitSha: commitSha.toLowerCase(),
    treeId: treeId.toLowerCase(),
    fileCount: paths.length,
    pathSha256: hash.digest("hex"),
  };
}

/**
 * Business purpose: Convert unsafe or inconsistent Azure tree metadata into the shared provider-response failure category.
 * Business rules: Provider details remain private and malformed metadata never degrades into an unverified archive root.
 * Execution flow: 1. Create the shared typed transport error. 2. Let the common handler preserve its established API problem mapping.
 * Failure cases: Callers reject the current archive operation without returning source bytes.
 * Side effects: Allocates an in-memory error value and performs no persistence or network action.
 */
function invalidTreeResponse(): GitHubArchiveTransportError {
  return new GitHubArchiveTransportError(
    GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
  );
}

function isZipSignature(value: Buffer): boolean {
  return (
    value.length >= 4 &&
    value[0] === 0x50 &&
    value[1] === 0x4b &&
    [
      [0x03, 0x04],
      [0x05, 0x06],
      [0x07, 0x08],
    ].some(([a, b]) => value[2] === a && value[3] === b)
  );
}
function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US");
}
/**
 * Business purpose: Ensure organization, project, and repository names remain one unambiguous path component.
 * Business rules: Empty names, dot traversal, separators, and control characters are rejected.
 * Execution flow: Apply bounded path-component checks before URI encoding.
 * Failure cases: Return false for any unsafe component.
 * Side effects: Pure validation.
 */
function safePathComponent(value: string): boolean {
  return (
    Boolean(value) &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !hasControlCharacters(value)
  );
}

/**
 * Business purpose: Reject control characters that could alter an Azure path or HTTP header.
 * Business rules: C0 controls and DEL are not allowed in repository identity components.
 * Execution flow: Inspect Unicode code points against the defined control ranges.
 * Failure cases: Return true when a forbidden character is present.
 * Side effects: Pure validation.
 */
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
