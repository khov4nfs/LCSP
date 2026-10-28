import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

import { Injectable } from "@nestjs/common";
import {
  LEGAL_SOURCE_IMPORT_REJECTION_REASONS as Reasons,
  LEGAL_SOURCE_LIMITS,
  LEGAL_SOURCE_SUPPORTED_MEDIA_TYPES,
  type LegalSourceImportRejectionReason,
} from "@lcsp/contracts/legal-source";

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** A server that cannot name the type is read by content; the caller sniffs the bytes. */
const UNDECLARED_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

export class ImportRejectedError extends Error {
  constructor(readonly reason: LegalSourceImportRejectionReason) {
    super(`Legal source import rejected: ${reason}`);
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface SafeFetchResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

/** The only code that touches the network, so every test can drive the fetcher without one. */
export interface SafeFetchTransport {
  resolve(hostname: string): Promise<ResolvedAddress[]>;
  get(input: {
    url: URL;
    address: ResolvedAddress;
    maxBytes: number;
    timeoutMs: number;
  }): Promise<SafeFetchResponse>;
}

export interface FetchedDocument {
  bytes: Buffer;
  /** Declared media type without parameters, or null when the server did not name one. */
  contentType: string | null;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirects: number;
  etag: string | null;
  lastModified: string | null;
  fileName: string | null;
  retrievedAt: Date;
}

/**
 * Everything that is not a public, globally routable unicast address. The list is allow-by-default
 * only for what IANA does not reserve, so a new private range has to be added here to be reachable
 * (it never is by accident).
 */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/**
 * Business purpose: Exclude non-IP and explicitly reserved/private addresses before a legal-source import connects to a host.
 *
 * Business rules:
 * - The address must parse as IPv4 or IPv6 and must not belong to a subnet in the maintained NON_PUBLIC block list.
 * - This predicate is the importer's address policy; it does not resolve DNS or verify a hostname itself.
 *
 * Execution flow:
 * 1. Determine the IP family of the supplied address.
 * 2. Reject non-address input and check valid addresses against the corresponding reserved-range list.
 *
 * Failure cases:
 * - Invalid IP strings and blocked ranges return false so callers fail closed.
 *
 * Side effects:
 * - None: the helper performs local address parsing and block-list lookup only.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Business purpose: Stop a legal-source import with the stable rejection reason required by the import contract.
 *
 * Business rules:
 * - Import policy failures are represented as a typed `ImportRejectedError` rather than a generic network error.
 * - The supplied reason is preserved unchanged for the caller's safe error mapping.
 *
 * Execution flow:
 * 1. Construct and throw an `ImportRejectedError` for the supplied rejection reason.
 *
 * Failure cases:
 * - Every invocation throws; it never returns a placeholder or successful response.
 *
 * Side effects:
 * - None: no network or persistence work is performed by the rejection helper.
 */
function reject(reason: LegalSourceImportRejectionReason): never {
  throw new ImportRejectedError(reason);
}

/**
 * Business purpose: Enforce the legal-source URL import boundary before a hostname can trigger DNS or network access.
 *
 * Business rules:
 * - Only HTTPS URLs without embedded credentials and using the default 443 port are eligible.
 * - The host must be a hostname, not an IP literal; address safety is checked separately after DNS resolution.
 *
 * Execution flow:
 * 1. Parse the input as a URL and reject malformed input.
 * 2. Validate scheme, credentials, port, and hostname shape.
 * 3. Return the parsed URL only when all pre-connection rules pass.
 *
 * Failure cases:
 * - Invalid syntax, non-HTTPS scheme, credentials, a non-443 port, or an IP-literal host throws the corresponding typed rejection reason.
 *
 * Side effects:
 * - None: URL validation occurs before any DNS lookup or connection.
 */
export function parseImportUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject(Reasons.INVALID_URL);
  }
  if (url.protocol !== "https:") return reject(Reasons.SCHEME_NOT_HTTPS);
  if (url.username !== "" || url.password !== "")
    return reject(Reasons.CREDENTIALS_IN_URL);
  if (url.port !== "" && url.port !== "443")
    return reject(Reasons.PORT_NOT_ALLOWED);
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (isIP(host) !== 0) return reject(Reasons.HOST_IS_ADDRESS);
  if (host === "") return reject(Reasons.INVALID_URL);
  return url;
}

/**
 * Business purpose: Normalize the server's declared response media type for legal-source import policy checks.
 *
 * Business rules:
 * - Only the media-type token before parameters is used, trimmed and lowercased.
 * - Missing or empty declarations remain null so the downstream byte detector can decide whether content is usable.
 *
 * Execution flow:
 * 1. Read the first semicolon-delimited header component.
 * 2. Return its normalized value or null when absent.
 *
 * Failure cases:
 * - Missing and blank headers return null; this helper does not reject the response by itself.
 *
 * Side effects:
 * - None: the header string is normalized in memory.
 */
function mediaTypeOf(header: string | undefined): string | null {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  return type ? type : null;
}

/**
 * Business purpose: Derive a safe display filename for the fetched legal-source document from response metadata or its URL.
 *
 * Business rules:
 * - A content-disposition filename is preferred; otherwise the final URL path segment is decoded and used.
 * - Control characters and path separators are stripped, and output is capped at 255 characters.
 * - An empty candidate remains null so the caller can represent the absence of a filename.
 *
 * Execution flow:
 * 1. Extract a filename parameter or decode the URL's last path segment.
 * 2. Remove controls and separators, trim, and cap the candidate.
 * 3. Return the cleaned filename or null when it is empty.
 *
 * Failure cases:
 * - An invalid percent escape in the fallback path may propagate `decodeURIComponent`'s URIError; no fabricated filename is substituted.
 *
 * Side effects:
 * - None: filename metadata is derived in memory and no local path is opened.
 */
function fileNameOf(url: URL, disposition: string | undefined): string | null {
  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/iu.exec(
    disposition ?? "",
  );
  const candidate =
    quoted?.[1] ?? decodeURIComponent(url.pathname.split("/").pop() ?? "");
  const cleaned = candidate
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\\/]/gu, "")
    .slice(0, 255);
  return cleaned === "" ? null : cleaned;
}

/**
 * Business purpose: Read one response header consistently when Node represents it as either a scalar or an array.
 *
 * Business rules:
 * - When multiple values are present, only the first value is used for import metadata and transport decisions.
 * - Missing values remain undefined.
 *
 * Execution flow:
 * 1. Read the named value from the parsed HTTP headers.
 * 2. Return the first array member or the scalar value unchanged.
 *
 * Failure cases:
 * - Missing headers return undefined; no fallback value is invented.
 *
 * Side effects:
 * - None: the helper reads an in-memory header record only.
 */
function headerValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Real network access: the connection is pinned to the address that was validated. */
@Injectable()
export class NodeSafeFetchTransport implements SafeFetchTransport {
  /**
   * Business purpose: Resolve every address for an import hostname so the caller can reject unsafe DNS answers.
   *
   * Business rules:
   * - Address resolution returns all DNS answers in resolver order for per-address safety validation and pinned transport.
   * - DNS failure is represented as an empty result so the fetcher rejects the unresolved host.
   *
   * Execution flow:
   * 1. Ask the platform resolver for all hostname addresses without reordering them.
   * 2. Return the resolved address/family pairs, or an empty array if resolution fails.
   *
   * Failure cases:
   * - Resolver errors are deliberately converted to an empty result; the fetcher maps that to HOST_NOT_RESOLVABLE.
   *
   * Side effects:
   * - Performs a DNS lookup; it does not open an HTTP connection or persist the result.
   */
  async resolve(hostname: string): Promise<ResolvedAddress[]> {
    try {
      return await lookup(hostname, { all: true, verbatim: true });
    } catch {
      return [];
    }
  }

  /**
   * Business purpose: Retrieve one bounded HTTPS response using an address that the caller already validated.
   *
   * Business rules:
   * - The connection is pinned to the validated address while TLS verifies the original hostname.
   * - Response size is capped from both content-length and streamed bytes, and request time is bounded.
   * - Only the metadata needed by the importer is retained with the response body.
   *
   * Execution flow:
   * 1. Start an HTTPS GET for the original host and path using the supplied pinned address.
   * 2. Reject bodies that exceed the maximum size and collect bounded chunks plus selected response headers.
   * 3. Resolve on response completion or reject on transport, size, or timeout failure.
   *
   * Failure cases:
   * - Oversized responses raise RESPONSE_TOO_LARGE; timeout and network errors map to typed import rejection reasons.
   * - The transport does not follow redirects; the service validates each redirect before issuing another request.
   *
   * Side effects:
   * - Opens one outbound HTTPS request and allocates a bounded response buffer; it does not persist fetched content.
   */
  get(input: {
    url: URL;
    address: ResolvedAddress;
    maxBytes: number;
    timeoutMs: number;
  }): Promise<SafeFetchResponse> {
    return new Promise((resolve, reject_) => {
      /**
       * Business purpose: Settle the pending bounded archive request with its response or transport error.
       *
       * Business rules:
       * - A non-null error rejects the promise; only an error-free response resolves it.
       * - The response is not replaced with empty content when transport fails.
       *
       * Execution flow:
       * 1. Check the callback error.
       * 2. Reject on error or resolve with the completed response value.
       *
       * Failure cases:
       * - Any supplied error rejects the request promise and remains visible to the transport caller.
       *
       * Side effects:
       * - Settles the enclosing request promise once for the network completion path.
       */
      const settle = (error: Error | null, value?: SafeFetchResponse) =>
        error ? reject_(error) : resolve(value as SafeFetchResponse);
      const req = httpsRequest(
        {
          protocol: "https:",
          hostname: input.url.hostname.replace(/^\[|\]$/gu, ""),
          port: 443,
          path: `${input.url.pathname}${input.url.search}`,
          method: "GET",
          // Connect to the validated address; TLS still verifies the certificate for the name.
          /**
           * Business purpose: Keep Node's connection lookup pinned to the address already checked by the import policy.
           *
           * Business rules:
           * - Both single-address and auto-select-family lookup shapes return only the supplied validated address.
           * - The resolver-provided hostname is ignored so a DNS rebinding response cannot change the destination.
           *
           * Execution flow:
           * 1. Inspect whether Node requested all candidate addresses.
           * 2. Return the validated address in the callback's expected shape for that request mode.
           *
           * Failure cases:
           * - Callback errors are left to Node's HTTPS client; no fallback address is consulted.
           *
           * Side effects:
           * - Supplies address data to the outbound HTTPS request; it performs no additional DNS lookup.
           */
          lookup: (_name, options, callback) => {
            // Node asks for every address when auto-select-family is on, one otherwise.
            if ((options as { all?: boolean }).all) {
              callback(null, [input.address]);
              return;
            }
            callback(null, input.address.address, input.address.family);
          },
          headers: {
            accept: LEGAL_SOURCE_SUPPORTED_MEDIA_TYPES.join(", "),
            "accept-encoding": "identity",
            "user-agent": "lcsp-legal-source-import/1",
          },
          timeout: input.timeoutMs,
        },
        (res) => {
          const declared = Number(headerValue(res.headers, "content-length"));
          if (Number.isFinite(declared) && declared > input.maxBytes) {
            res.destroy();
            settle(new ImportRejectedError(Reasons.RESPONSE_TOO_LARGE));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > input.maxBytes) {
              res.destroy();
              settle(new ImportRejectedError(Reasons.RESPONSE_TOO_LARGE));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            settle(null, {
              status: res.statusCode ?? 0,
              headers: {
                location: headerValue(res.headers, "location"),
                "content-type": headerValue(res.headers, "content-type"),
                "content-disposition": headerValue(
                  res.headers,
                  "content-disposition",
                ),
                etag: headerValue(res.headers, "etag"),
                "last-modified": headerValue(res.headers, "last-modified"),
              },
              body: Buffer.concat(chunks),
            }),
          );
          res.on("error", () =>
            settle(new ImportRejectedError(Reasons.CONNECTION_FAILED)),
          );
        },
      );
      // The idle timeout alone lets a slow-drip server hold the request open; this is the total.
      const deadline = setTimeout(() => {
        req.destroy();
        settle(new ImportRejectedError(Reasons.TIMED_OUT));
      }, input.timeoutMs * 2);
      deadline.unref();
      req.on("close", () => clearTimeout(deadline));
      req.on("timeout", () => {
        req.destroy();
        settle(new ImportRejectedError(Reasons.TIMED_OUT));
      });
      req.on("error", () =>
        settle(new ImportRejectedError(Reasons.CONNECTION_FAILED)),
      );
      req.end();
    });
  }
}

/**
 * Fetches one public document for a Legal Source import. It is safe to point at user input:
 * https only, no credentials, port 443, a host name (never an address), every resolved address
 * must be public, the connection is pinned to a validated address (no DNS rebinding), every
 * redirect is validated the same way, and size, time and content type are bounded. The result is
 * stored as a snapshot; the live URL is never fetched again.
 */
@Injectable()
export class SafeUrlFetcherService {
  constructor(private readonly transport: NodeSafeFetchTransport) {}

  /**
   * Business purpose: Fetch one public document as a bounded immutable-source candidate for legal-source import.
   *
   * Business rules:
   * - The URL and each redirect must satisfy HTTPS, credential, port, hostname, and public-address rules.
   * - Every DNS answer must be public, and transport connects only to an address already validated for that hostname.
   * - At most three redirects are followed; successful responses must be HTTP 200, nonempty, and declare a supported or undeclared content type.
   * - Request time and body size use the shared legal-source limits; content type is returned for downstream byte-level verification.
   *
   * Execution flow:
   * 1. Parse and validate the requested URL before DNS resolution.
   * 2. Resolve and validate addresses, trying each pinned address when a connection attempt fails.
   * 3. Validate every redirect through the same URL policy and enforce the redirect limit.
   * 4. Validate the terminal response and return source bytes, URL lineage, selected headers, and retrieval time.
   *
   * Failure cases:
   * - Unsafe URLs or addresses, unresolved hosts, rejected redirects, excessive redirects, non-200 responses, unsupported content types, empty bodies, timeouts, and transport errors raise typed import rejection errors.
   * - Connection failures may move to another validated address; policy failures are not retried as a different outcome.
   *
   * Side effects:
   * - Performs DNS lookups and outbound HTTPS requests and allocates a bounded response buffer; persistence is left to the importing workflow.
   */
  async fetch(rawUrl: string): Promise<FetchedDocument> {
    const requestedUrl = parseImportUrl(rawUrl);
    let current = requestedUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const addresses = await this.transport.resolve(
        current.hostname.replace(/^\[|\]$/gu, ""),
      );
      if (addresses.length === 0) return reject(Reasons.HOST_NOT_RESOLVABLE);
      if (!addresses.every((item) => isPublicAddress(item.address)))
        return reject(Reasons.ADDRESS_NOT_PUBLIC);

      let response: SafeFetchResponse | undefined;
      let lastError: unknown;
      for (const address of addresses) {
        try {
          response = await this.transport.get({
            url: current,
            address,
            maxBytes: LEGAL_SOURCE_LIMITS.maxDocumentBytes,
            timeoutMs: REQUEST_TIMEOUT_MS,
          });
          break;
        } catch (error) {
          if (
            error instanceof ImportRejectedError &&
            error.reason !== Reasons.CONNECTION_FAILED
          )
            throw error;
          lastError = error;
        }
      }
      if (!response)
        throw lastError instanceof Error
          ? lastError
          : new ImportRejectedError(Reasons.CONNECTION_FAILED);

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.location;
        if (!location) return reject(Reasons.REDIRECT_REJECTED);
        if (redirects === MAX_REDIRECTS)
          return reject(Reasons.TOO_MANY_REDIRECTS);
        try {
          current = parseImportUrl(new URL(location, current).toString());
        } catch {
          return reject(Reasons.REDIRECT_REJECTED);
        }
        continue;
      }
      if (response.status !== 200) return reject(Reasons.RESPONSE_NOT_OK);

      const contentType = mediaTypeOf(response.headers["content-type"]);
      if (
        contentType !== null &&
        !UNDECLARED_CONTENT_TYPES.has(contentType) &&
        !(LEGAL_SOURCE_SUPPORTED_MEDIA_TYPES as readonly string[]).includes(
          contentType,
        )
      )
        return reject(Reasons.CONTENT_TYPE_NOT_ALLOWED);
      if (response.body.length === 0) return reject(Reasons.RESPONSE_EMPTY);

      return {
        bytes: response.body,
        contentType:
          contentType !== null && !UNDECLARED_CONTENT_TYPES.has(contentType)
            ? contentType
            : null,
        requestedUrl: requestedUrl.toString(),
        finalUrl: current.toString(),
        status: response.status,
        redirects,
        etag: response.headers.etag ?? null,
        lastModified: response.headers["last-modified"] ?? null,
        fileName: fileNameOf(current, response.headers["content-disposition"]),
        retrievedAt: new Date(),
      };
    }
    return reject(Reasons.TOO_MANY_REDIRECTS);
  }
}
