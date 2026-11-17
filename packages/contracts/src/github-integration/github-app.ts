import { z } from "zod";

export const GITHUB_APP_INSTALLATION_STATUSES = {
  active: "ACTIVE",
  awaitingOrgApproval: "AWAITING_ORG_APPROVAL",
  suspended: "SUSPENDED",
  revoked: "REVOKED",
} as const;

export type GitHubAppInstallationStatus =
  (typeof GITHUB_APP_INSTALLATION_STATUSES)[keyof typeof GITHUB_APP_INSTALLATION_STATUSES];

export const GITHUB_APP_INSTALLATION_TARGETS = {
  selected: "SELECTED",
  all: "ALL",
} as const;

export type GitHubAppInstallationTarget =
  (typeof GITHUB_APP_INSTALLATION_TARGETS)[keyof typeof GITHUB_APP_INSTALLATION_TARGETS];

export const GITHUB_APP_ACCOUNT_TYPES = {
  user: "USER",
  organization: "ORGANIZATION",
} as const;

export type GitHubAppAccountType =
  (typeof GITHUB_APP_ACCOUNT_TYPES)[keyof typeof GITHUB_APP_ACCOUNT_TYPES];

export const GITHUB_APP_PERMISSION_SCOPES = {
  contentsRead: "CONTENTS_READ",
  metadataRead: "METADATA_READ",
} as const;

export type GitHubAppPermissionScope =
  (typeof GITHUB_APP_PERMISSION_SCOPES)[keyof typeof GITHUB_APP_PERMISSION_SCOPES];

export const GITHUB_CREDENTIAL_MIGRATION_STATUSES = {
  notMigrated: "NOT_MIGRATED",
  eligible: "ELIGIBLE",
  migrated: "MIGRATED",
} as const;

export type GitHubCredentialMigrationStatus =
  (typeof GITHUB_CREDENTIAL_MIGRATION_STATUSES)[keyof typeof GITHUB_CREDENTIAL_MIGRATION_STATUSES];

export const githubAppInstallationConfigSchema = z.object({
  appId: z.string().min(1),
  installationId: z.string().min(1),
  accountType: z.enum([
    GITHUB_APP_ACCOUNT_TYPES.user,
    GITHUB_APP_ACCOUNT_TYPES.organization,
  ]),
  accountLogin: z.string().min(1),
  targetSelection: z.enum([
    GITHUB_APP_INSTALLATION_TARGETS.selected,
    GITHUB_APP_INSTALLATION_TARGETS.all,
  ]).default(GITHUB_APP_INSTALLATION_TARGETS.selected),
  permissions: z.array(
    z.enum([
      GITHUB_APP_PERMISSION_SCOPES.contentsRead,
      GITHUB_APP_PERMISSION_SCOPES.metadataRead,
    ]),
  ).min(1),
  tokenTtlSeconds: z.number().int().positive().default(3600),
  cacheTtlSeconds: z.number().int().positive().default(3000),
});

export type GitHubAppInstallationConfig = z.infer<
  typeof githubAppInstallationConfigSchema
>;

/**
 * Business purpose:
 * Validate and resolve GitHub App installation configuration against the ADR LCSP-476 security invariants.
 *
 * Business rules:
 * - Scopes are strictly bounded to read-only repository contents and metadata; write scopes are rejected.
 * - Installation target defaults to SELECTED repositories to enforce least privilege.
 * - In-memory token cache TTL cannot exceed token TTL minus a 300-second jitter buffer to avoid in-flight expiration.
 *
 * Execution flow:
 * 1. Normalize and parse raw installation input through githubAppInstallationConfigSchema.
 * 2. Verify that permissions do not contain any unapproved or write capabilities.
 * 3. Ensure the token cache TTL provides sufficient headroom before the upstream GitHub token expires.
 * 4. Return the resolved, immutable GitHubAppInstallationConfig object.
 *
 * Failure cases:
 * - Throws error if permissions are empty or include forbidden write scopes.
 * - Throws error if cache TTL is greater than token TTL minus 300 seconds.
 *
 * Side effects:
 * - Pure configuration calculation; no network I/O or state mutation.
 */
export function resolveGitHubAppInstallationPolicy(
  rawConfig: z.input<typeof githubAppInstallationConfigSchema>,
): GitHubAppInstallationConfig {
  const parsed = githubAppInstallationConfigSchema.parse(rawConfig);

  const allowedPermissions = new Set<string>([
    GITHUB_APP_PERMISSION_SCOPES.contentsRead,
    GITHUB_APP_PERMISSION_SCOPES.metadataRead,
  ]);

  for (const perm of parsed.permissions) {
    if (!allowedPermissions.has(perm)) {
      throw new Error(`Forbidden GitHub App permission scope: ${perm}`);
    }
  }

  const maxSafeCacheTtl = parsed.tokenTtlSeconds - 300;
  if (parsed.cacheTtlSeconds > maxSafeCacheTtl) {
    throw new Error(
      `Cache TTL (${parsed.cacheTtlSeconds}s) exceeds maximum safe cache duration (${maxSafeCacheTtl}s) for token lifetime (${parsed.tokenTtlSeconds}s)`,
    );
  }

  return parsed;
}
