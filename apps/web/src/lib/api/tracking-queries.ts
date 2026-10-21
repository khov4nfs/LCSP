"use client";

import { useQuery } from "@tanstack/react-query";
import {
  adminTrackingOperationalSchema,
  customerTrackingObligationsSchema,
  customerTrackingOverviewSchema,
  customerTrackingReportsSchema,
  type CustomerTrackingPortfolioQuery,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated } from "./api-request";
import { getAppLocaleSnapshot } from "../locale";

const trackingKeys = {
  overview: (search: string) => ["tracking", "overview", search, getAppLocaleSnapshot()] as const,
  obligations: (query: CustomerTrackingPortfolioQuery) => ["tracking", "obligations", query] as const,
  reports: (query: CustomerTrackingPortfolioQuery) => ["tracking", "reports", query] as const,
  admin: ["tracking", "admin-operational"] as const,
};

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.size ? `?${params.toString()}` : "";
}

export function useCustomerTrackingOverviewQuery(search = "", offset = 0) {
  const locale = getAppLocaleSnapshot();
  return useQuery({
    queryKey: [...trackingKeys.overview(search), offset],
    queryFn: () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const params = queryString({ limit: 50, offset, actionsLimit: 8, changesLimit: 8, search: search || undefined, since, locale });
      return apiValidated(`/api/assessments/tracking/overview${params}`, customerTrackingOverviewSchema);
    },
  });
}

export function useCustomerTrackingObligationsQuery(query: CustomerTrackingPortfolioQuery = {}) {
  const params = queryString({ ...query, limit: query.limit ?? 50 });
  return useQuery({
    queryKey: trackingKeys.obligations(query),
    queryFn: () => apiValidated(`/api/assessments/tracking/obligations${params}`, customerTrackingObligationsSchema),
  });
}

export function useCustomerTrackingReportsQuery(query: CustomerTrackingPortfolioQuery = {}) {
  const params = queryString({ ...query, limit: query.limit ?? 50 });
  return useQuery({
    queryKey: trackingKeys.reports(query),
    queryFn: () => apiValidated(`/api/assessments/tracking/reports${params}`, customerTrackingReportsSchema),
  });
}

export function useAdminTrackingOperationalQuery() {
  return useQuery({
    queryKey: trackingKeys.admin,
    queryFn: () => apiValidated("/api/admin/tracking/operational", adminTrackingOperationalSchema),
  });
}
