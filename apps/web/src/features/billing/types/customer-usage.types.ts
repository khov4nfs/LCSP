import type {
  CUSTOMER_USAGE_DIMENSIONS,
  CustomerUsageAnalytics,
  CustomerUsageQuery,
} from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";

export type CustomerUsageDimension =
  (typeof CUSTOMER_USAGE_DIMENSIONS)[keyof typeof CUSTOMER_USAGE_DIMENSIONS];

export type CustomerUsageHistoryRowProps = {
  locale: Locale;
  item: CustomerUsageAnalytics["items"][number];
};
export type CustomerUsagePanelProps = {
  locale: Locale;
  onOpenBilling: () => void;
};
export type CustomerUsageFiltersProps = {
  locale: Locale;
  query: CustomerUsageQuery;
  onApply: (query: CustomerUsageQuery) => void;
};
export type CustomerUsageSummaryProps = {
  locale: Locale;
  summary: CustomerUsageAnalytics["summary"];
};
export type CustomerUsageHistoryProps = {
  locale: Locale;
  report: CustomerUsageAnalytics;
  onPageChange: (page: number) => void;
  disabled: boolean;
};
export type CustomerUsageBreakdownProps = {
  locale: Locale;
  rows: CustomerUsageAnalytics["breakdowns"];
};
