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
    /**
     * Business purpose: Generate query key for caching the user's privacy settings.
     *
     * Business rules:
     * - Returns isolated cache key under the auth namespace.
     *
     * Execution flow:
     * 1. Return readonly tuple ["auth", "privacy-settings"].
     *
     * Failure cases:
     * - None: pure key generator.
     *
     * Side effects:
     * - None: pure key generator.
     */
    privacySettings: () => ["auth", "privacy-settings"] as const,
    /**
     * Business purpose: Generate query key for caching the user's capability settings.
     *
     * Business rules:
     * - Returns isolated cache key under the auth namespace.
     *
     * Execution flow:
     * 1. Return readonly tuple ["auth", "capability-settings"].
     *
     * Failure cases:
     * - None: pure key generator.
     *
     * Side effects:
     * - None: pure key generator.
     */
    capabilitySettings: () => ["auth", "capability-settings"] as const,
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
    /**
     * Business purpose: Isolate cached Admin model pricing overview responses by active query filters.
     *
     * Business rules:
     * - Preserve the normalized filter parameters in the Admin billing model-pricing cache namespace.
     *
     * Execution flow:
     * 1. Return the immutable tuple `["admin", "billing", "model-pricing", params]`.
     *
     * Failure cases:
     * - Filter validation belongs to the query loader; this helper performs no network or schema checks.
     *
     * Side effects:
     * - None: pure cache-key construction.
     */
    modelPricing: (params: Record<string, unknown>) =>
      ["admin", "billing", "model-pricing", params] as const,
    /**
     * Business purpose: Keep Admin case queue caches distinct for each pagination/filter selection.
     * Business rules:
     * - The supplied parameters are part of the immutable query identity.
     * Execution flow:
     * 1. Return the Admin case queue namespace with the supplied parameters.
     * Failure cases:
     * - Invalid filters are rejected by the query loader; this helper does not transform them.
     * Side effects:
     * - Pure cache-key construction; no network or persistence.
     */
    // Why: Case detail and queue pages must not share cached financial evidence.
    // How: Include query filters in the Admin queue cache key.
    // Invariant: A stale queue row cannot masquerade as a fresh provider evidence detail.
    modelReconciliationCases: (params: Record<string, unknown>) =>
      ["admin", "billing", "model-reconciliation", "cases", params] as const,
    /**
     * Business purpose: Cache one authoritative Admin case detail independently from queue projections.
     * Business rules:
     * - Each opaque case ID receives its own cache entry.
     * Execution flow:
     * 1. Return the Admin case detail namespace with the selected ID.
     * Failure cases:
     * - Missing or invalid IDs are rejected by the detail query/BFF, not this helper.
     * Side effects:
     * - Pure cache-key construction; no network or persistence.
     */
    // Why: An evidence detail must not be reused for another case.
    // How: Include the case ID in the cache key.
    // Invariant: No cross-case evidence display through cache reuse.
    modelReconciliationCase: (caseId: string) =>
      ["admin", "billing", "model-reconciliation", "cases", caseId] as const,
    usersRoot: () => ["admin", "users"] as const,
    usersList: (params?: Record<string, unknown>) =>
      ["admin", "users", params ?? {}] as const,
    userDetail: (userId: string) => ["admin", "users", userId] as const,
  },
} as const;
