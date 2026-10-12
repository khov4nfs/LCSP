export interface LegalSourceChunkInput {
  id: string;
  locator: string;
  content: string;
  contentSha256: string;
  hierarchy: Record<string, unknown>;
  legalStatus: string;
  pageStart?: number | null;
  pageEnd?: number | null;
}

export interface LegalSourceDocumentInput {
  documentId: string;
  title: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceEffectStatus: string;
  effectiveDate?: string | null;
  snapshotPath?: string | null;
  chunks: LegalSourceChunkInput[];
}

export interface IngestLegalSourceRequest {
  version: string;
  sourceManifest: Record<string, unknown>;
  documents: LegalSourceDocumentInput[];
  /** @description Optional retrieval timestamp; defaults to server time if not provided */
  retrievedAt?: string | null;
  /** @description Optional ingestion run identifier for audit trail */
  ingestionRunId?: string | null;
}

export interface ActivateLegalSourceRequest {
  integrityManifestRef: string;
  retrievalValidationRef: string;
  idempotencyKey: string;
  scopeDescription?: string;
  comments?: string | null;
}

export interface RegisterValidatedRetrievalIndexRequest {
  version: string;
  configHash: string;
  contentHash: string;
  validationManifestRef: string;
  validatedAt?: string | null;
}
