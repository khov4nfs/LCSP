export const LEGAL_RISK_LEVELS = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
} as const;

export type LegalRiskLevel =
  (typeof LEGAL_RISK_LEVELS)[keyof typeof LEGAL_RISK_LEVELS];
