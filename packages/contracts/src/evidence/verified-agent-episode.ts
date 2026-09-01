export const VERIFIED_AGENT_EPISODE_TRUST_LEVELS = {
  verifiedExample: "VERIFIED_EXAMPLE",
} as const;

export type VerifiedAgentEpisodeTrustLevel =
  (typeof VERIFIED_AGENT_EPISODE_TRUST_LEVELS)[keyof typeof VERIFIED_AGENT_EPISODE_TRUST_LEVELS];

export const VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES = {
  verified: "VERIFIED",
} as const;

export type VerifiedAgentEpisodeValidationStatus =
  (typeof VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES)[keyof typeof VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES];

export const VERIFIED_AGENT_EPISODE_RECORD_STATUSES = {
  active: "ACTIVE",
  expired: "EXPIRED",
} as const;

export type VerifiedAgentEpisodeRecordStatus =
  (typeof VERIFIED_AGENT_EPISODE_RECORD_STATUSES)[keyof typeof VERIFIED_AGENT_EPISODE_RECORD_STATUSES];
