"use client";

export const apiQueryKeys = {
  auth: {
    settingsProfile: () => ["auth", "settings-profile"] as const,
    sessions: () => ["auth", "sessions"] as const,
  },
  githubIntegration: {
    providerCredentials: () => ["provider-credentials"] as const,
    repositories: () => ["github-integration", "repositories"] as const,
  },
  billing: {
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
