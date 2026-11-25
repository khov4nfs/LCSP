export const LEGAL_RULE_FILTER_ALL = "ALL";
export const LEGAL_RULE_FILTER_PREPARED_WITH_ASSESSMENT_RULES =
  "PREPARED_WITH_ASSESSMENT_RULES";
export const LEGAL_RULE_COMPARE_NONE = "NONE";

// A UI-local cap on one import run; each document is still limited to 256 items by the API contract.
export const ASSESSMENT_RULE_IMPORT_MAX_FILES = 32;
// Message keys (resolved from @lcsp/i18n) explaining why a chosen file cannot be sent.
export const ASSESSMENT_RULE_IMPORT_FILE_ISSUES = {
  INVALID_JSON: "importFileInvalidJson",
  INVALID_DOCUMENT: "importFileInvalidDocument",
  WRONG_CATALOG: "importFileWrongCatalog",
  STALE_REVISION: "importFileStaleRevision",
} as const;
// The import dialog moves strictly IDLE -> CHECKING -> CHECKED -> IMPORTING -> DONE; any failure returns to IDLE.
export const ASSESSMENT_RULE_IMPORT_STAGES = {
  IDLE: "IDLE",
  CHECKING: "CHECKING",
  CHECKED: "CHECKED",
  IMPORTING: "IMPORTING",
  DONE: "DONE",
} as const;
