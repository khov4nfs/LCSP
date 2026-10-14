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

function extensionOf(fileName: string | null | undefined): string | null {
  const match = /\.([A-Za-z0-9]{1,8})$/u.exec(fileName ?? "");
  return match ? match[1].toLowerCase() : null;
}

function declaredType(
  header: string | null | undefined,
): LegalSourceMediaType | null {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  return (Object.values(Media) as string[]).includes(type ?? "")
    ? (type as LegalSourceMediaType)
    : null;
}

function looksLikeText(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  // A truncated multi-byte sequence at the cut is fine; anything else that is not UTF-8 is not text.
  const text = head.toString("utf8");
  return !text.includes("�") || text.endsWith("�");
}

/**
 * The media type a document really is, decided from its bytes and cross-checked against what the
 * uploader or server claimed. A claim never widens what is accepted: bytes that are not what they
 * claim to be are refused, and anything outside the supported set is null.
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

/** A stable, URL-safe identity for a document inside a version. */
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

/** A display name that cannot smuggle path separators or control characters. */
export function cleanFileName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f\\/]/gu, "")
      .trim()
      .slice(0, 255) || "document"
  );
}
