import { fileURLToPath } from "node:url";

/** Parsed form of a V1 `DocumentRequest.documentUrl`. Pure: performs no I/O. */
export type LegacyReportReference =
  | { kind: "NONE" }
  | { kind: "MALFORMED" }
  | { kind: "UNSUPPORTED_SCHEME"; scheme: string }
  | { kind: "FILE"; path: string }
  | { kind: "HTTP"; url: URL; host: string };

export function parseLegacyReportReference(
  documentUrl: string | null | undefined,
): LegacyReportReference {
  if (documentUrl === null || documentUrl === undefined)
    return { kind: "NONE" };
  const trimmed = documentUrl.trim();
  if (trimmed === "") return { kind: "NONE" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: "MALFORMED" };
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    if (url.hostname === "") return { kind: "MALFORMED" };
    return { kind: "HTTP", url, host: url.hostname.toLowerCase() };
  }
  if (url.protocol === "file:") {
    if (url.hostname !== "" && url.hostname !== "localhost")
      return { kind: "MALFORMED" };
    try {
      return { kind: "FILE", path: fileURLToPath(url) };
    } catch {
      return { kind: "MALFORMED" };
    }
  }
  return {
    kind: "UNSUPPORTED_SCHEME",
    scheme: url.protocol.replace(/:$/u, ""),
  };
}

/**
 * Archive-safe form of a reference: scheme, host and path only. Credentials, signed query strings
 * and fragments never reach the archive (the V1 row itself is left untouched).
 */
export function redactLegacyReportReference(
  documentUrl: string | null | undefined,
): string | null {
  const reference = parseLegacyReportReference(documentUrl);
  if (reference.kind === "HTTP")
    return `${reference.url.protocol}//${reference.url.host}${reference.url.pathname}`;
  if (reference.kind === "FILE") return `file://${reference.path}`;
  return null;
}
