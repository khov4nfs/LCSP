"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  adminTrackingOperationalSchema,
  customerTrackingObligationsSchema,
  customerTrackingObligationAssessmentsSchema,
  type CustomerTrackingObligationAssessmentsQuery,
  customerTrackingOverviewSchema,
  customerTrackingReportsSchema,
  type CustomerTrackingListQuery,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated } from "./api-request";
import { getAppLocaleSnapshot } from "../locale";

const trackingKeys = {
  overview: (search: string) => ["tracking", "overview", search, getAppLocaleSnapshot()] as const,
  obligations: (query: CustomerTrackingListQuery) => ["tracking", "obligations", query] as const,
  reports: (query: CustomerTrackingListQuery) => ["tracking", "reports", query] as const,
  admin: ["tracking", "admin-operational"] as const,
};

function queryString(values: Record<string, string | number | boolean | undefined>) {
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

export function useCustomerTrackingObligationsQuery(query: CustomerTrackingListQuery = {}) {
  const params = queryString({ ...query, limit: query.limit ?? 50 });
  return useQuery({
    queryKey: trackingKeys.obligations(query),
    queryFn: () => apiValidated(`/api/assessments/tracking/obligations${params}`, customerTrackingObligationsSchema),
  });
}

export function useCustomerTrackingObligationAssessmentsQuery(
  query: CustomerTrackingObligationAssessmentsQuery,
  enabled = true,
) {
  const params = queryString({ ...query, limit: query.limit ?? 20 });
  return useQuery({
    queryKey: ["tracking", "obligation-assessments", query],
    queryFn: () => apiValidated(
      `/api/assessments/tracking/obligations/assessments${params}`,
      customerTrackingObligationAssessmentsSchema,
    ),
    enabled,
  });
}

export function useCustomerTrackingObligationAssessmentsPages(
  query: CustomerTrackingObligationAssessmentsQuery,
  initialOffset: number,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["tracking", "obligation-assessments-pages", query],
    initialPageParam: initialOffset,
    queryFn: ({ pageParam }) => {
      const params = queryString({ ...query, limit: query.limit ?? 20, offset: pageParam });
      return apiValidated(
        `/api/assessments/tracking/obligations/assessments${params}`,
        customerTrackingObligationAssessmentsSchema,
      );
    },
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
    enabled,
  });
}

export function useCustomerTrackingReportsQuery(query: CustomerTrackingListQuery = {}) {
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
