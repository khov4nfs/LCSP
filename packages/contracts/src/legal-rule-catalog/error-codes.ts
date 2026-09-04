export const LEGAL_RULE_ERROR_CODES = {
  citationUnresolved: "RULE_CITATION_UNRESOLVED",
  citationRepealed: "RULE_CITATION_REPEALED",
  catalogVersionNotFound: "CATALOG_VERSION_NOT_FOUND",
  catalogVersionAlreadyApproved: "CATALOG_VERSION_ALREADY_APPROVED",
  sourceSnapshotNotFound: "SOURCE_SNAPSHOT_NOT_FOUND",
  sourceSnapshotConflict: "SOURCE_SNAPSHOT_CONFLICT",
  approvedCorpusNotFound: "APPROVED_CORPUS_NOT_FOUND",
  approvedCatalogNotFound: "APPROVED_RULE_CATALOG_NOT_FOUND",
  corpusVersionNotFound: "CORPUS_VERSION_NOT_FOUND",
  corpusVersionAlreadyApproved: "CORPUS_VERSION_ALREADY_APPROVED",
  corpusIngestInvalid: "CORPUS_INGEST_INVALID",
} as const;

export const RESUME_WAITING_RUNS_BLOCK_CODES = {
  corpusNotApproved: "CORPUS_VERSION_NOT_APPROVED",
  indexNotReady: "CORPUS_INDEX_NOT_READY",
  ruleCatalogNotApproved: "LEGAL_RULE_CATALOG_NOT_APPROVED",
} as const;
