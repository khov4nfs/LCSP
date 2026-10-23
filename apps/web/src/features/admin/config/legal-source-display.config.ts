import {
  LEGAL_SOURCE_DOCUMENT_FAILURE_CODES,
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES,
  LEGAL_SOURCE_DOCUMENT_ORIGINS,
  LEGAL_SOURCE_CHUNK_STATUSES,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  LEGAL_SOURCE_VERSION_BLOCKERS,
  type LegalSourceDocumentFailureCode,
  type LegalSourceDocumentIngestionState,
  type LegalSourceDocumentOrigin,
  type LegalSourceLifecycleStatus,
  type LegalSourceStructureProfile,
  type LegalSourceVersionBlocker,
} from "@lcsp/contracts/legal-source";

export const LEGAL_SOURCE_STATUS_MESSAGE_KEYS: Record<
  LegalSourceLifecycleStatus,
  string
> = {
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.draft]: "pages.legalSources.statuses.DRAFT",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.active]:
    "pages.legalSources.statuses.ACTIVE",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.superseded]:
    "pages.legalSources.statuses.SUPERSEDED",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid]:
    "pages.legalSources.statuses.INVALID",
};

export const LEGAL_SOURCE_INGESTION_MESSAGE_KEYS: Record<
  LegalSourceDocumentIngestionState,
  string
> = {
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PENDING]:
    "pages.legalSources.ingestionStates.PENDING",
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PROCESSING]:
    "pages.legalSources.ingestionStates.PROCESSING",
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.READY]:
    "pages.legalSources.ingestionStates.READY",
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.FAILED]:
    "pages.legalSources.ingestionStates.FAILED",
};

export const LEGAL_SOURCE_ORIGIN_MESSAGE_KEYS: Record<
  LegalSourceDocumentOrigin,
  string
> = {
  [LEGAL_SOURCE_DOCUMENT_ORIGINS.UPLOAD]: "pages.legalSources.origins.UPLOAD",
  [LEGAL_SOURCE_DOCUMENT_ORIGINS.URL_IMPORT]:
    "pages.legalSources.origins.URL_IMPORT",
  [LEGAL_SOURCE_DOCUMENT_ORIGINS.MIGRATED]:
    "pages.legalSources.origins.MIGRATED",
};

export const LEGAL_SOURCE_BLOCKER_MESSAGE_KEYS: Record<
  LegalSourceVersionBlocker,
  string
> = {
  [LEGAL_SOURCE_VERSION_BLOCKERS.NO_DOCUMENTS]:
    "pages.legalSources.blockers.NO_DOCUMENTS",
  [LEGAL_SOURCE_VERSION_BLOCKERS.DOCUMENT_NOT_READY]:
    "pages.legalSources.blockers.DOCUMENT_NOT_READY",
  [LEGAL_SOURCE_VERSION_BLOCKERS.VERSION_NOT_DRAFT]:
    "pages.legalSources.blockers.VERSION_NOT_DRAFT",
  [LEGAL_SOURCE_VERSION_BLOCKERS.INDEX_NOT_VALID]:
    "pages.legalSources.blockers.INDEX_NOT_VALID",
};

export const LEGAL_SOURCE_FAILURE_MESSAGE_KEYS: Record<
  LegalSourceDocumentFailureCode,
  string
> = {
  [LEGAL_SOURCE_DOCUMENT_FAILURE_CODES.UNSUPPORTED_MEDIA_TYPE]:
    "pages.legalSources.failureCodes.UNSUPPORTED_MEDIA_TYPE",
  [LEGAL_SOURCE_DOCUMENT_FAILURE_CODES.EXTRACTION_FAILED]:
    "pages.legalSources.failureCodes.EXTRACTION_FAILED",
  [LEGAL_SOURCE_DOCUMENT_FAILURE_CODES.NO_EXTRACTABLE_TEXT]:
    "pages.legalSources.failureCodes.NO_EXTRACTABLE_TEXT",
  [LEGAL_SOURCE_DOCUMENT_FAILURE_CODES.NO_CHUNKS]:
    "pages.legalSources.failureCodes.NO_CHUNKS",
  [LEGAL_SOURCE_DOCUMENT_FAILURE_CODES.DUPLICATE_LOCATOR]:
    "pages.legalSources.failureCodes.DUPLICATE_LOCATOR",
  [LEGAL_SOURCE_DOCUMENT_FAILURE_CODES.RUNTIME_UNAVAILABLE]:
    "pages.legalSources.failureCodes.RUNTIME_UNAVAILABLE",
};

export const LEGAL_SOURCE_STRUCTURE_PROFILE_MESSAGE_KEYS: Record<
  LegalSourceStructureProfile,
  string
> = {
  [LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO]:
    "pages.legalSources.structureProfiles.AUTO",
  [LEGAL_SOURCE_STRUCTURE_PROFILES.ARTICLES]:
    "pages.legalSources.structureProfiles.ARTICLES",
  [LEGAL_SOURCE_STRUCTURE_PROFILES.NUMBERED_SECTIONS]:
    "pages.legalSources.structureProfiles.NUMBERED_SECTIONS",
  [LEGAL_SOURCE_STRUCTURE_PROFILES.PARAGRAPHS]:
    "pages.legalSources.structureProfiles.PARAGRAPHS",
};

export const LEGAL_SOURCE_EFFECT_STATUS_MESSAGE_KEYS: Record<
  (typeof LEGAL_SOURCE_CHUNK_STATUSES)[keyof typeof LEGAL_SOURCE_CHUNK_STATUSES],
  string
> = {
  [LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE]:
    "pages.legalSources.effectStatuses.EFFECTIVE",
  [LEGAL_SOURCE_CHUNK_STATUSES.REPEALED]:
    "pages.legalSources.effectStatuses.REPEALED",
  [LEGAL_SOURCE_CHUNK_STATUSES.FUTURE]:
    "pages.legalSources.effectStatuses.FUTURE",
  [LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN]:
    "pages.legalSources.effectStatuses.UNKNOWN",
};

export const LEGAL_SOURCE_CHUNK_PAGE_SIZES = [10, 25, 50, 100] as const;

export const LEGAL_SOURCE_STRUCTURE_PROFILE_OPTIONS = [
  {
    value: LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO,
    labelKey:
      LEGAL_SOURCE_STRUCTURE_PROFILE_MESSAGE_KEYS[
        LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO
      ],
  },
  {
    value: LEGAL_SOURCE_STRUCTURE_PROFILES.ARTICLES,
    labelKey:
      LEGAL_SOURCE_STRUCTURE_PROFILE_MESSAGE_KEYS[
        LEGAL_SOURCE_STRUCTURE_PROFILES.ARTICLES
      ],
  },
  {
    value: LEGAL_SOURCE_STRUCTURE_PROFILES.NUMBERED_SECTIONS,
    labelKey:
      LEGAL_SOURCE_STRUCTURE_PROFILE_MESSAGE_KEYS[
        LEGAL_SOURCE_STRUCTURE_PROFILES.NUMBERED_SECTIONS
      ],
  },
  {
    value: LEGAL_SOURCE_STRUCTURE_PROFILES.PARAGRAPHS,
    labelKey:
      LEGAL_SOURCE_STRUCTURE_PROFILE_MESSAGE_KEYS[
        LEGAL_SOURCE_STRUCTURE_PROFILES.PARAGRAPHS
      ],
  },
] as const;
