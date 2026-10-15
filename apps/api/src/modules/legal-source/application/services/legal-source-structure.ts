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

export function sha256Ref(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export const STRUCTURAL_CONFIG_HASH = sha256Ref(
  `${LEGAL_SOURCE_STRUCTURAL_INDEX.tool}@${LEGAL_SOURCE_STRUCTURAL_INDEX.toolVersion}`,
);

/**
 * Deterministic validation of a version's content, the managed counterpart of a retrieval-index
 * build: every document has chunks, every chunk is addressable by a unique locator inside its
 * document, and every stored hash matches the stored text. Nothing here reads legal meaning.
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

/** Chunk identity is version-qualified so the same document can appear in many versions. */
export function managedChunkId(
  legalSourceVersionId: string,
  documentId: string,
  locator: string,
): string {
  return `${legalSourceVersionId}::${documentId}::${locator}`;
}

export function structuralIndexVersion(versionLabel: string): string {
  return `${versionLabel}:${LEGAL_SOURCE_STRUCTURAL_INDEX.suffix}`;
}

export function structuralValidationRef(contentHash: string): string {
  return `${LEGAL_SOURCE_STRUCTURAL_INDEX.manifestScheme}:${contentHash.replace("sha256:", "")}`;
}

export function structuralIntegrityRef(contentHash: string): string {
  return `${LEGAL_SOURCE_STRUCTURAL_INDEX.integrityScheme}:${contentHash.replace("sha256:", "")}`;
}
