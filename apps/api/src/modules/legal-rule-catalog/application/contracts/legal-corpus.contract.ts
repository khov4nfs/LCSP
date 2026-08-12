export interface LegalCorpusChunkInput {
  id: string;
  locator: string;
  content: string;
  contentSha256: string;
  hierarchy: Record<string, unknown>;
  legalStatus: string;
  pageStart?: number | null;
  pageEnd?: number | null;
}

export interface LegalCorpusDocumentInput {
  documentId: string;
  title: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceEffectStatus: string;
  effectiveDate?: string | null;
  snapshotPath?: string | null;
  chunks: LegalCorpusChunkInput[];
}

export interface IngestLegalCorpusRequest {
  version: string;
  sourceManifest: Record<string, unknown>;
  documents: LegalCorpusDocumentInput[];
  /** @description Optional retrieval timestamp; defaults to server time if not provided */
  retrievedAt?: string | null;
  /** @description Optional ingestion run identifier for audit trail */
  ingestionRunId?: string | null;
}

export interface ApproveLegalCorpusRequest {
  integrityManifestRef: string;
  retrievalValidationRef: string;
  idempotencyKey: string;
  scopeDescription?: string;
  comments?: string | null;
}
