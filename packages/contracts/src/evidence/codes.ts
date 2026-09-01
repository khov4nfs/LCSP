export const EVIDENCE_ERROR_CODES = {
  notFound: "EVIDENCE_NOT_FOUND",
  validationFailed: "EVIDENCE_VALIDATION_FAILED",
} as const;

export const EVIDENCE_SEVERITIES = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
} as const;

export type EvidenceSeverity =
  (typeof EVIDENCE_SEVERITIES)[keyof typeof EVIDENCE_SEVERITIES];

export type EvidenceErrorCode =
  (typeof EVIDENCE_ERROR_CODES)[keyof typeof EVIDENCE_ERROR_CODES];
