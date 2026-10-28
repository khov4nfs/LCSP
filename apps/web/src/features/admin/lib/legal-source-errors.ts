import {
  LEGAL_SOURCE_IMPORT_REJECTION_REASONS,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES,
} from "@lcsp/contracts/legal-source";

import { ApiRequestError } from "@/lib/api/api-request";

const errorMessageKeys: Record<string, string> = {
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.requestInvalid]:
    "pages.legalSources.errors.requestInvalid",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.slugTaken]:
    "pages.legalSources.errors.slugTaken",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.sourceNotFound]:
    "pages.legalSources.errors.sourceNotFound",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.versionImmutable]:
    "pages.legalSources.errors.versionImmutable",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.versionNotReady]:
    "pages.legalSources.errors.versionNotReady",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.versionInUse]:
    "pages.legalSources.errors.versionInUse",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentUnsupportedMediaType]:
    "pages.legalSources.errors.documentUnsupportedMediaType",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentTooLarge]:
    "pages.legalSources.errors.documentTooLarge",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentEmpty]:
    "pages.legalSources.errors.documentEmpty",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentDuplicate]:
    "pages.legalSources.errors.documentDuplicate",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentLimitReached]:
    "pages.legalSources.errors.documentLimitReached",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentNotRetryable]:
    "pages.legalSources.errors.documentNotRetryable",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentNotFound]:
    "pages.legalSources.errors.documentNotFound",
  [LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.importFetchFailed]:
    "pages.legalSources.errors.importFetchFailed",
};

export function legalSourceErrorMessageKey(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return "pages.legalSources.errors.requestFailed";
  }
  if (
    error.problemCode === LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.importUrlRejected
  ) {
    const reason = error.problem?.meta?.reason;
    const knownReason = Object.values(
      LEGAL_SOURCE_IMPORT_REJECTION_REASONS,
    ).find((value) => value === reason);
    return knownReason
      ? `pages.legalSources.errors.importUrlRejected.${knownReason}`
      : "pages.legalSources.errors.importUrlRejected.generic";
  }
  return (
    errorMessageKeys[error.problemCode] ??
    "pages.legalSources.errors.requestFailed"
  );
}
