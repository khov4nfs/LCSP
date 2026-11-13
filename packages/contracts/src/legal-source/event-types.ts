export const LEGAL_SOURCE_EVENT_TYPES = {
  documentEffectUpdated: "LEGAL_SOURCE_DOCUMENT_EFFECT_UPDATED",
  documentCorpusRoleUpdated: "LEGAL_SOURCE_DOCUMENT_CORPUS_ROLE_UPDATED",
  legalSourceIngested: "legal_source.ingested",
  legalSourceVersionActivated: "event.legal-source.activated.v1",
  legalSourceDeleted: "event.legal-source.deleted.v1",
} as const;

export const LEGAL_SOURCE_EVENT_SCHEMA_VERSIONS = {
  deletion: "legal-source.deletion.v1",
} as const;
