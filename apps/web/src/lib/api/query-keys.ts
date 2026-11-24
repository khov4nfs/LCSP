"use client";

export const apiQueryKeys = {
  auth: {
    settingsProfile: () => ["auth", "settings-profile"] as const,
    sessions: () => ["auth", "sessions"] as const,
    /**
     * Business purpose: Generate query key for caching the user's linked OAuth identities.
     *
     * Business rules:
     * - Returns isolated cache key under the auth namespace.
     *
     * Execution flow:
     * 1. Return readonly tuple ["auth", "oauth-identities"].
     *
     * Failure cases:
     * - None: pure key generator.
     *
     * Side effects:
     * - None: pure key generator.
     */
    oauthIdentities: () => ["auth", "oauth-identities"] as const,
  },
  githubIntegration: {
    providerCredentials: () => ["provider-credentials"] as const,
    repositories: () => ["github-integration", "repositories"] as const,
  },
  billing: {
    /**
     * Business purpose: Isolate cached customer usage by every active report parameter.
     * Business rules:
     * - Preserve fixed timestamps, filters and pagination in the private billing namespace.
     * Execution flow:
     * 1. Return the customer usage namespace and the supplied parameters.
     * Failure cases:
     * - Query validation belongs to the loader; this key does not normalize invalid values.
     * Side effects:
     * - Pure cache-key construction.
     */
    usage: (params: Record<string, unknown>) =>
      ["billing", "usage", params] as const,
    wallet: () => ["billing", "wallet"] as const,
    history: (page: number, pageSize: number) =>
      ["billing", "history", page, pageSize] as const,
    estimate: (amountVnd: string) =>
      ["billing", "estimate", amountVnd] as const,
    order: (orderId: string) => ["billing", "order", orderId] as const,
  },
  workspace: {
    detail: () => ["workspace"] as const,
    assessments: () => ["assessments"] as const,
    selection: () => ["mock-workspace-selection"] as const,
  },
  admin: {
    /**
     * Business purpose: Separate Admin usage cache entries by their complete filter parameters.
     *
     * Business rules:
     * - Retain the supplied parameter object in the Admin usage key; this helper does not
     *   validate or normalize filters.
     *
     * Execution flow:
     * 1. Return the Admin usage namespace and supplied parameters as a readonly key.
     *
     * Failure cases:
     * - Malformed filter values are left for query validation, rather than silently changed here.
     *
     * Side effects:
     * - None: pure cache-key construction.
     */
    usage: (params: Record<string, unknown>) =>
      ["admin", "usage", params] as const,
    overview: (period?: string) =>
      ["admin", "overview", period ?? "30D"] as const,
    billing: (
      period: string,
      status: string,
      gateway: string,
      page: number,
      pageSize: number,
    ) => ["admin", "billing", period, status, gateway, page, pageSize] as const,
    usersRoot: () => ["admin", "users"] as const,
    usersList: (params?: Record<string, unknown>) =>
      ["admin", "users", params ?? {}] as const,
    userDetail: (userId: string) => ["admin", "users", userId] as const,
  },
} as const;
