import { createHash } from "node:crypto";

import { LEGAL_SOURCE_STRUCTURAL_INDEX } from "@lcsp/contracts/legal-source";

export interface StructuralDocument {
  documentId: string;
  chunks: Array<{
    locator: string;
    content: string;
    contentSha256: string;
    legalEffectStatus?: string;
    legalStatusSourceRef?: string | null;
  }>;
}

export interface StructuralValidation {
  valid: boolean;
  /** Codes only (`CODE` or `CODE:documentId`); never chunk text. */
  failures: string[];
  /** Digest of what the version contains: documents, locators and chunk hashes in a fixed order. */
  contentHash: string;
  configHash: string;
}

/**
 * Business purpose: Create a stable SHA-256 reference for legal-source content and validation artifacts.
 *
 * Business rules:
 * - The returned reference always carries the `sha256:` scheme prefix.
 * - The supplied string or bytes are hashed exactly as received; callers decide any canonicalization before hashing.
 *
 * Execution flow:
 * 1. Feed the supplied content to SHA-256.
 * 2. Return the lowercase hexadecimal digest with its scheme prefix.
 *
 * Failure cases:
 * - Invalid crypto input propagates the underlying hashing error rather than producing a placeholder reference.
 *
 * Side effects:
 * - None: hashing is local and does not persist or mutate the source value.
 */
export function sha256Ref(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export const STRUCTURAL_CONFIG_HASH = sha256Ref(
  `${LEGAL_SOURCE_STRUCTURAL_INDEX.tool}@${LEGAL_SOURCE_STRUCTURAL_INDEX.toolVersion}`,
);

/**
 * Business purpose: Determine whether a legal-source draft has internally consistent document and chunk structure for activation.
 *
 * Business rules:
 * - Every version must contain a document; each document must have at least one chunk.
 * - Chunk content must be nonempty, its stored digest must match, and its locator must be unique within the document.
 * - This structural gate records provided status metadata but does not interpret legal meaning or effect.
 *
 * Execution flow:
 * 1. Record the empty-version and empty-document failures.
 * 2. Validate each chunk's content, digest, and per-document locator while building canonical digest rows.
 * 3. Sort the rows and return deduplicated failure codes plus content and configuration hashes.
 *
 * Failure cases:
 * - Structural defects are returned as failure codes and set `valid` false; malformed runtime inputs may propagate ordinary property or hashing errors.
 *
 * Side effects:
 * - None: validation derives hashes and failure codes from the supplied document snapshot only.
 */
export function validateStructure(
  documents: StructuralDocument[],
): StructuralValidation {
  const failures: string[] = [];
  if (documents.length === 0) failures.push("NO_DOCUMENTS");
  const lines: string[] = [];
  for (const document of documents) {
    if (document.chunks.length === 0) {
      failures.push(`DOCUMENT_WITHOUT_CHUNKS:${document.documentId}`);
      continue;
    }
    const locators = new Set<string>();
    for (const chunk of document.chunks) {
      if (chunk.content.trim() === "")
        failures.push(`EMPTY_CHUNK:${document.documentId}`);
      if (sha256Ref(chunk.content) !== chunk.contentSha256)
        failures.push(`CHUNK_HASH_MISMATCH:${document.documentId}`);
      if (locators.has(chunk.locator))
        failures.push(`DUPLICATE_LOCATOR:${document.documentId}`);
      locators.add(chunk.locator);
      lines.push(
        `${document.documentId}\t${chunk.locator}\t${chunk.contentSha256}\t${chunk.legalEffectStatus ?? "UNKNOWN"}\t${chunk.legalStatusSourceRef ?? ""}`,
      );
    }
  }
  lines.sort();
  return {
    valid: failures.length === 0,
    failures: [...new Set(failures)],
    contentHash: sha256Ref(lines.join("\n")),
    configHash: STRUCTURAL_CONFIG_HASH,
  };
}

/**
 * Business purpose: Give an ingested chunk an identifier scoped to its legal-source version, document, and locator.
 *
 * Business rules:
 * - Version identity is part of the key so a copied document in another source version does not share the chunk identity.
 * - The caller must provide canonical version, document, and locator values; this helper does not validate them.
 *
 * Execution flow:
 * 1. Join the three identity components with the persisted `::` separator.
 *
 * Failure cases:
 * - No domain rejection is performed; missing or malformed components remain visible in the composed identifier.
 *
 * Side effects:
 * - None: the identifier is composed in memory without persistence.
 */
export function managedChunkId(
  legalSourceVersionId: string,
  documentId: string,
  locator: string,
): string {
  return `${legalSourceVersionId}::${documentId}::${locator}`;
}

/**
 * Business purpose: Give each managed retrieval index a version label that also records its structural-index tool revision.
 *
 * Business rules:
 * - The configured structural-index suffix is appended unchanged so callers can distinguish index format revisions.
 * - The version label is not normalized or checked for uniqueness here.
 *
 * Execution flow:
 * 1. Append the configured suffix to the legal-source version label using the persisted colon separator.
 *
 * Failure cases:
 * - No validation is performed; the caller is responsible for supplying a valid version label.
 *
 * Side effects:
 * - None: this function returns a deterministic index label in memory.
 */
export function structuralIndexVersion(versionLabel: string): string {
  return `${versionLabel}:${LEGAL_SOURCE_STRUCTURAL_INDEX.suffix}`;
}

/**
 * Business purpose: Bind a successful structural validation digest to the versioned manifest reference scheme.
 *
 * Business rules:
 * - The configured manifest scheme is authoritative for the artifact reference.
 * - The helper removes only the `sha256:` prefix from the supplied digest; digest validation belongs to the validator.
 *
 * Execution flow:
 * 1. Strip the hash scheme prefix when present.
 * 2. Prepend the configured structural-manifest scheme.
 *
 * Failure cases:
 * - No validation is performed, so malformed digest strings are still composed and must be rejected by their owning contract if invalid.
 *
 * Side effects:
 * - None: the reference is composed in memory.
 */
export function structuralValidationRef(contentHash: string): string {
  return `${LEGAL_SOURCE_STRUCTURAL_INDEX.manifestScheme}:${contentHash.replace("sha256:", "")}`;
}

/**
 * Business purpose: Bind a validated structural digest to the integrity-manifest reference scheme used during source activation.
 *
 * Business rules:
 * - Activation references use the configured integrity scheme and preserve the digest payload without its `sha256:` marker.
 * - This helper formats provenance and does not establish that the underlying content is valid.
 *
 * Execution flow:
 * 1. Remove the `sha256:` prefix when present.
 * 2. Prefix the remaining value with the configured integrity-manifest scheme.
 *
 * Failure cases:
 * - Malformed input is formatted as supplied; upstream structural validation owns digest correctness.
 *
 * Side effects:
 * - None: no stored integrity record is created by this formatter.
 */
export function structuralIntegrityRef(contentHash: string): string {
  return `${LEGAL_SOURCE_STRUCTURAL_INDEX.integrityScheme}:${contentHash.replace("sha256:", "")}`;
}
