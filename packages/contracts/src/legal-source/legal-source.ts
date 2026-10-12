export const LEGAL_SOURCE_TRUST_POLICIES = {
  officialSourceAutoTrusted: "OFFICIAL_SOURCE_AUTO_TRUSTED",
} as const;

export type LegalSourceTrustPolicy =
  (typeof LEGAL_SOURCE_TRUST_POLICIES)[keyof typeof LEGAL_SOURCE_TRUST_POLICIES];
