export const LEGAL_CORPUS_TRUST_POLICIES = {
  officialSourceAutoTrusted: "OFFICIAL_SOURCE_AUTO_TRUSTED",
} as const;

export type LegalCorpusTrustPolicy =
  (typeof LEGAL_CORPUS_TRUST_POLICIES)[keyof typeof LEGAL_CORPUS_TRUST_POLICIES];
