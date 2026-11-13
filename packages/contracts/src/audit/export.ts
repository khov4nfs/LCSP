export const AUDIT_EXPORT_STATUSES = {
  queued: "QUEUED",
  generating: "GENERATING",
  ready: "READY",
  failed: "FAILED",
} as const;

export type AuditExportStatus =
  (typeof AUDIT_EXPORT_STATUSES)[keyof typeof AUDIT_EXPORT_STATUSES];

export const AUDIT_ERROR_CODES = {
  exportNotFound: "AUDIT_EXPORT_NOT_FOUND",
  invalidQuery: "INVALID_AUDIT_QUERY",
  invalidDateRange: "INVALID_DATE_RANGE",
  dateRangeExceeded: "AUDIT_DATE_RANGE_EXCEEDED",
  downloadUrlInvalid: "AUDIT_DOWNLOAD_URL_INVALID",
} as const;

export const AUDIT_EVENT_TYPES = {
  exportGenerated: "AUDIT_EXPORT_GENERATED",
  sessionExported: "ASSESSMENT_SESSION_EXPORTED",
  legalSourceDeleted: "LEGAL_SOURCE_DELETED",
} as const;

/** Published audit export formats recorded in the audit ledger. */
export const AUDIT_EXPORT_KINDS = {
  sessionJson: "SESSION_JSON",
} as const;
export type AuditExportKind =
  (typeof AUDIT_EXPORT_KINDS)[keyof typeof AUDIT_EXPORT_KINDS];
