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
}

export interface ApproveLegalCorpusRequest {
  scopeDescription?: string;
  comments?: string | null;
}
