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

// Canonical tool access modes controlling how connector tools are loaded for new assessments.
// Rationale: Centralizes allowed runtime tool loading strategies across backend, BFF, and web UI.
export const TOOL_ACCESS_MODES = {
  loadWhenNeeded: "LOAD_WHEN_NEEDED",
  guided: "GUIDED",
} as const;

export type ToolAccessMode =
  (typeof TOOL_ACCESS_MODES)[keyof typeof TOOL_ACCESS_MODES];

// Canonical domain allowlist policy modes enforced by the execution sandbox.
export const DOMAIN_ALLOWLIST_MODES = {
  packageManagersOnly: "PACKAGE_MANAGERS_ONLY",
} as const;

export type DomainAllowlistMode =
  (typeof DOMAIN_ALLOWLIST_MODES)[keyof typeof DOMAIN_ALLOWLIST_MODES];

// Canonical system policy identifiers explaining why non-configurable capabilities are restricted.
export const CAPABILITY_POLICY_REASONS = {
  platformRestricted: "PLATFORM_RESTRICTED",
  runtimePolicyRestricted: "RUNTIME_POLICY_RESTRICTED",
  unsupportedCustomDomains: "UNSUPPORTED_CUSTOM_DOMAINS",
} as const;

export type CapabilityPolicyReason =
  (typeof CAPABILITY_POLICY_REASONS)[keyof typeof CAPABILITY_POLICY_REASONS];

