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

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

function reject(reason: LegalSourceImportRejectionReason): never {
  throw new ImportRejectedError(reason);
}

/** Syntactic rules a URL must satisfy before any DNS lookup or connection. */
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

function mediaTypeOf(header: string | undefined): string | null {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  return type ? type : null;
}

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

function headerValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Real network access: the connection is pinned to the address that was validated. */
@Injectable()
export class NodeSafeFetchTransport implements SafeFetchTransport {
  async resolve(hostname: string): Promise<ResolvedAddress[]> {
    try {
      return await lookup(hostname, { all: true, verbatim: true });
    } catch {
      return [];
    }
  }

  get(input: {
    url: URL;
    address: ResolvedAddress;
    maxBytes: number;
    timeoutMs: number;
  }): Promise<SafeFetchResponse> {
    return new Promise((resolve, reject_) => {
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
