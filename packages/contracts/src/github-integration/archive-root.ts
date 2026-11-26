export const ARCHIVE_ROOT_VERIFICATION_STATUSES = {
  verifiedWrapper: "VERIFIED_WRAPPER",
  verifiedRootless: "VERIFIED_ROOTLESS",
  unknown: "UNKNOWN",
} as const;

export type ArchiveRootVerificationStatus =
  (typeof ARCHIVE_ROOT_VERIFICATION_STATUSES)[keyof typeof ARCHIVE_ROOT_VERIFICATION_STATUSES];
