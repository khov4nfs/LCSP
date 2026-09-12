export const ADMIN_OVERVIEW_PERIODS = {
  p7d: "7D",
  p30d: "30D",
  p90d: "90D",
} as const;

export type AdminOverviewPeriod =
  (typeof ADMIN_OVERVIEW_PERIODS)[keyof typeof ADMIN_OVERVIEW_PERIODS];

export const ADMIN_OVERVIEW_ACTION_KEYS = {
  suspendedAccount: "SUSPENDED_ACCOUNT",
  restoredAccount: "RESTORED_ACCOUNT",
  invitedUser: "INVITED_USER",
  publishedCorpus: "PUBLISHED_CORPUS",
  discardedDraft: "DISCARDED_DRAFT",
  generalAction: "GENERAL_ACTION",
} as const;

export type AdminOverviewActionKey =
  (typeof ADMIN_OVERVIEW_ACTION_KEYS)[keyof typeof ADMIN_OVERVIEW_ACTION_KEYS];

export interface AdminOverviewActivityPoint {
  date: string;
  timestamp: string;
  startedCount: number;
  completedCount: number;
}

export interface AdminOverviewAccountDistribution {
  activeCount: number;
  invitedCount: number;
  suspendedCount: number;
  deactivatedCount: number;
  totalCount: number;
}

export interface AdminRecentActivityItem {
  id: string;
  eventType: string;
  actionKey: AdminOverviewActionKey;
  occurredAt: string;
  adminEmail: string | null;
  adminName: string | null;
  target: string | null;
}

export interface AdminCorpusStatusSummary {
  current: {
    version: string;
    sourceCount: number;
    ruleCount: number | null;
    publishedAt: string | null;
  } | null;
  draft: {
    version: string;
    sourceCount: number;
    ruleCount: number | null;
    createdAt: string | null;
  } | null;
}

export interface AdminOverviewStats {
  period: AdminOverviewPeriod;
  periodDays: number;
  summary: {
    totalUsers: {
      count: number;
      periodChange: number;
    };
    activeUsers: {
      count: number;
      percentageOfTotal: number;
    };
    assessments: {
      totalCount: number;
      periodCompletedCount: number;
    };
    currentCorpus: {
      version: string | null;
      sourceCount: number;
      ruleCount: number | null;
    };
  };
  assessmentActivity: {
    points: AdminOverviewActivityPoint[];
    totalStarted: number;
    totalCompleted: number;
    startDate: string;
    endDate: string;
  };
  accountDistribution: AdminOverviewAccountDistribution;
  recentActivity: AdminRecentActivityItem[];
  corpusStatus: AdminCorpusStatusSummary;
}
