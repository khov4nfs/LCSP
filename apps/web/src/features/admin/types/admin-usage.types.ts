import type {
  AdminUsageAnalytics,
  UsageAnalyticsSummary,
} from "@lcsp/contracts/billing";
import type { AdminUsageFilters } from "../schemas/admin-usage.schema";
export type UsageFiltersProps = {
  onApply: (filters: AdminUsageFilters) => void;
};
export type UsageMetricsProps = { summary: UsageAnalyticsSummary };
export type UsageInvocation = AdminUsageAnalytics["items"][number];
export type UsageInvocationsProps = { items: UsageInvocation[] };
