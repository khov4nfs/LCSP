import {
  LEGAL_SOURCE_MEDIA_TYPES as Media,
  type LegalSourceMediaType,
} from "@lcsp/contracts/legal-source";

const EXTENSION_TYPES: Record<string, LegalSourceMediaType> = {
  pdf: Media.PDF,
  htm: Media.HTML,
  html: Media.HTML,
  txt: Media.PLAIN_TEXT,
  md: Media.MARKDOWN,
  markdown: Media.MARKDOWN,
  docx: Media.DOCX,
};

const TEXT_TYPES = new Set<LegalSourceMediaType>([
  Media.HTML,
  Media.PLAIN_TEXT,
  Media.MARKDOWN,
]);

/**
 * Business purpose: Extract a normalized filename suffix that can inform legal-source upload type checks.
 *
 * Business rules:
 * - Only a final extension of one through eight ASCII letters or digits is considered.
 * - The suffix is a hint for later content validation and does not prove the uploaded bytes' type.
 *
 * Execution flow:
 * 1. Match the final dot-separated suffix from the supplied filename, treating absent input as empty.
 * 2. Return its lowercase form, or null when the suffix does not match the supported shape.
 *
 * Failure cases:
 * - Missing filenames, trailing dots, and suffixes outside the length or character rules yield null.
 *
 * Side effects:
 * - None: this helper only derives a filename hint in memory.
 */
function extensionOf(fileName: string | null | undefined): string | null {
  const match = /\.([A-Za-z0-9]{1,8})$/u.exec(fileName ?? "");
  return match ? match[1].toLowerCase() : null;
}

/**
 * Business purpose: Normalize a declared upload content type only when it belongs to the legal-source media contract.
 *
 * Business rules:
 * - Parameters after the first semicolon are not part of the media type.
 * - Unsupported or absent declarations cannot authorize a media type and are represented as null.
 *
 * Execution flow:
 * 1. Take the first header component, trim it, and lowercase it.
 * 2. Return it only if it exactly matches a configured legal-source media type.
 *
 * Failure cases:
 * - Missing, empty, or unsupported declarations return null so callers can reject or use another validation hint.
 *
 * Side effects:
 * - None: the function normalizes and checks an in-memory header value.
 */
function declaredType(
  header: string | null | undefined,
): LegalSourceMediaType | null {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  return (Object.values(Media) as string[]).includes(type ?? "")
    ? (type as LegalSourceMediaType)
    : null;
}

/**
 * Business purpose: Decide whether the leading upload bytes are safe to treat as text before parsing a supported text document.
 *
 * Business rules:
 * - Only the first 8,192 bytes are inspected for NUL bytes and UTF-8 decoding problems.
 * - The decoded prefix is accepted when it has no replacement character or ends with one, allowing a cut multibyte sequence at the sample boundary.
 *
 * Execution flow:
 * 1. Inspect a bounded prefix of the buffer.
 * 2. Reject binary markers or invalid UTF-8 within that prefix, except a possible truncated final sequence.
 *
 * Failure cases:
 * - A NUL byte or a replacement character without a terminal replacement returns false; if the prefix ends in a replacement character, earlier replacement characters are also tolerated by this check.
 *
 * Side effects:
 * - None: the buffer is inspected without mutation or external work.
 */
function looksLikeText(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  // A truncated multi-byte sequence at the cut is fine; anything else that is not UTF-8 is not text.
  const text = head.toString("utf8");
  return !text.includes("�") || text.endsWith("�");
}

/**
 * Business purpose: Classify an uploaded legal-source document only when its content is consistent with a supported media type.
 *
 * Business rules:
 * - Empty uploads and unsupported or contradictory byte/type combinations are rejected as null.
 * - Recognized declarations take precedence over filename extensions; either is still checked against file signatures or text content.
 * - A ZIP signature is accepted only when the supported DOCX type is claimed, and HTML markup is not silently treated as ordinary text.
 *
 * Execution flow:
 * 1. Resolve declared and filename type hints, then inspect PDF and ZIP signatures.
 * 2. For text candidates, require a text-like byte prefix and apply the HTML-specific checks.
 * 3. Return the supported type that passes those checks, or null when no type is established.
 *
 * Failure cases:
 * - Empty content, an unsupported claim, a signature mismatch, or invalid text bytes returns null.
 *
 * Side effects:
 * - None: classification reads the supplied buffer and does not change it or persist an upload.
 */
export function detectMediaType(input: {
  bytes: Buffer;
  declaredType?: string | null;
  fileName?: string | null;
}): LegalSourceMediaType | null {
  const { bytes } = input;
  if (bytes.length === 0) return null;
  const declared = declaredType(input.declaredType);
  const byName = EXTENSION_TYPES[extensionOf(input.fileName) ?? ""] ?? null;
  const claimed = declared ?? byName;

  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    return claimed === null || claimed === Media.PDF ? Media.PDF : null;
  }
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    // A ZIP container is only a document when it claims to be the one supported ZIP-based format.
    return claimed === Media.DOCX ? Media.DOCX : null;
  }
  if (claimed === null || !TEXT_TYPES.has(claimed) || !looksLikeText(bytes)) {
    return null;
  }
  const head = bytes
    .subarray(0, 1024)
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  const isMarkup =
    head.startsWith("<!doctype html") || head.startsWith("<html");
  // Markup is only HTML when it claims to be; plain text that merely contains angle brackets is not.
  if (claimed === Media.HTML)
    return isMarkup || head.startsWith("<") ? Media.HTML : null;
  return isMarkup ? Media.HTML : claimed;
}

/**
 * Business purpose: Derive the normalized document identifier used to address an imported document within a legal-source version.
 *
 * Business rules:
 * - Unicode marks and Vietnamese đ variants are normalized before non-alphanumeric runs become hyphens.
 * - The identifier is capped at 60 characters; version-level persistence remains responsible for detecting collisions.
 *
 * Execution flow:
 * 1. Apply Unicode compatibility decomposition and remove combining marks.
 * 2. Lowercase, remove a short filename extension, and collapse other characters into hyphen-separated words.
 * 3. Trim and cap the slug, using `document` when no addressable characters remain.
 *
 * Failure cases:
 * - Empty or punctuation-only input does not fail; it resolves to the fallback identifier `document`.
 *
 * Side effects:
 * - None: the result is derived from the supplied text without allocating or persisting a version-scoped record.
 */
export function documentIdFrom(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/gu, "d")
    .replace(/Đ/gu, "D")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60)
    .replace(/-+$/u, "");
  return slug === "" ? "document" : slug;
}

/**
 * Business purpose: Produce a bounded display filename for legal-source document metadata without retaining path controls.
 *
 * Business rules:
 * - Control characters and path separators are removed so user-supplied names cannot carry a path.
 * - The trimmed display value is limited to 255 characters and an empty result uses `document`.
 *
 * Execution flow:
 * 1. Remove control characters and slash characters from the supplied name.
 * 2. Trim the result, cap its length, and apply the fallback when nothing remains.
 *
 * Failure cases:
 * - Empty or fully stripped names are accepted as the fallback display name; no validation exception is raised here.
 *
 * Side effects:
 * - None: the function returns sanitized metadata in memory and does not read or write a filesystem path.
 */
export function cleanFileName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f\\/]/gu, "")
      .trim()
      .slice(0, 255) || "document"
  );
}
