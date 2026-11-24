export const AUTH_MEMBERSHIP_STATUSES = {
  invited: "INVITED",
  active: "ACTIVE",
  revoked: "REVOKED",
} as const;

export const AUTH_ACCOUNT_STATUSES = {
  active: "ACTIVE",
  suspended: "SUSPENDED",
  invited: "INVITED",
  deactivated: "DEACTIVATED",
} as const;

export const WORKSPACE_CAPABILITY_SOURCES = {
  backendProjection: "BACKEND_PROJECTION",
} as const;

export const OAUTH_LINK_OUTCOMES = {
  success: "SUCCESS",
  alreadyLinked: "ALREADY_LINKED",
  cancelled: "CANCELLED",
  failed: "FAILED",
  sessionExpired: "SESSION_EXPIRED",
} as const;

export type OAuthLinkOutcome =
  (typeof OAUTH_LINK_OUTCOMES)[keyof typeof OAUTH_LINK_OUTCOMES];

export const OAUTH_LINK_QUERY_RESULTS = {
  success: "success",
  alreadyLinked: "already_linked",
  cancelled: "cancelled",
  failed: "failed",
  sessionExpired: "session_expired",
} as const;

export type OAuthLinkQueryResult =
  (typeof OAUTH_LINK_QUERY_RESULTS)[keyof typeof OAUTH_LINK_QUERY_RESULTS];

