import {
  GITHUB_APP_INSTALLATION_STATUSES,
  GITHUB_APP_INSTALLATION_TARGETS,
  GITHUB_APP_ACCOUNT_TYPES,
  GITHUB_APP_PERMISSION_SCOPES,
  GITHUB_CREDENTIAL_MIGRATION_STATUSES,
  githubAppInstallationConfigSchema,
  resolveGitHubAppInstallationPolicy,
} from "../src/github-integration/index.ts";

describe("GitHub App onboarding contracts (ADR LCSP-476)", () => {
  it("defines canonical contract value sets in SCREAMING_SNAKE_CASE", () => {
    expect(GITHUB_APP_INSTALLATION_STATUSES.active).toBe("ACTIVE");
    expect(GITHUB_APP_INSTALLATION_STATUSES.awaitingOrgApproval).toBe(
      "AWAITING_ORG_APPROVAL",
    );
    expect(GITHUB_APP_INSTALLATION_STATUSES.suspended).toBe("SUSPENDED");
    expect(GITHUB_APP_INSTALLATION_STATUSES.revoked).toBe("REVOKED");

    expect(GITHUB_APP_INSTALLATION_TARGETS.selected).toBe("SELECTED");
    expect(GITHUB_APP_INSTALLATION_TARGETS.all).toBe("ALL");

    expect(GITHUB_APP_ACCOUNT_TYPES.user).toBe("USER");
    expect(GITHUB_APP_ACCOUNT_TYPES.organization).toBe("ORGANIZATION");

    expect(GITHUB_APP_PERMISSION_SCOPES.contentsRead).toBe("CONTENTS_READ");
    expect(GITHUB_APP_PERMISSION_SCOPES.metadataRead).toBe("METADATA_READ");

    expect(GITHUB_CREDENTIAL_MIGRATION_STATUSES.notMigrated).toBe(
      "NOT_MIGRATED",
    );
    expect(GITHUB_CREDENTIAL_MIGRATION_STATUSES.eligible).toBe("ELIGIBLE");
    expect(GITHUB_CREDENTIAL_MIGRATION_STATUSES.migrated).toBe("MIGRATED");
  });

  it("validates valid GitHub App installation configuration with least-privilege defaults", () => {
    const policy = resolveGitHubAppInstallationPolicy({
      appId: "12345",
      installationId: "987654321",
      accountType: GITHUB_APP_ACCOUNT_TYPES.organization,
      accountLogin: "acme-corp",
      permissions: [
        GITHUB_APP_PERMISSION_SCOPES.contentsRead,
        GITHUB_APP_PERMISSION_SCOPES.metadataRead,
      ],
    });

    expect(policy.appId).toBe("12345");
    expect(policy.installationId).toBe("987654321");
    expect(policy.targetSelection).toBe(
      GITHUB_APP_INSTALLATION_TARGETS.selected,
    );
    expect(policy.tokenTtlSeconds).toBe(3600);
    expect(policy.cacheTtlSeconds).toBe(3000);
  });

  it("supports explicit ALL targetSelection when chosen by user", () => {
    const policy = resolveGitHubAppInstallationPolicy({
      appId: "12345",
      installationId: "987654321",
      accountType: GITHUB_APP_ACCOUNT_TYPES.user,
      accountLogin: "alice-dev",
      targetSelection: GITHUB_APP_INSTALLATION_TARGETS.all,
      permissions: [GITHUB_APP_PERMISSION_SCOPES.contentsRead],
    });

    expect(policy.targetSelection).toBe(GITHUB_APP_INSTALLATION_TARGETS.all);
  });

  it("rejects forbidden or write permissions", () => {
    expect(() =>
      resolveGitHubAppInstallationPolicy({
        appId: "12345",
        installationId: "987654321",
        accountType: GITHUB_APP_ACCOUNT_TYPES.organization,
        accountLogin: "acme-corp",
        // @ts-expect-error testing invalid scope
        permissions: ["CONTENTS_WRITE"],
      }),
    ).toThrow();
  });

  it("rejects token cache TTL that exceeds token lifetime minus 300s jitter buffer", () => {
    expect(() =>
      resolveGitHubAppInstallationPolicy({
        appId: "12345",
        installationId: "987654321",
        accountType: GITHUB_APP_ACCOUNT_TYPES.organization,
        accountLogin: "acme-corp",
        permissions: [GITHUB_APP_PERMISSION_SCOPES.contentsRead],
        tokenTtlSeconds: 3600,
        cacheTtlSeconds: 3500, // exceeds 3300s max safe cache duration
      }),
    ).toThrow(/Cache TTL/);
  });
});
