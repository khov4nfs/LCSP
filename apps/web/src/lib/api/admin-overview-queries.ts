"use client";

import { useQuery } from "@tanstack/react-query";
import type { AdminOverviewPeriod } from "@lcsp/contracts/auth";
import { fetchAdminOverview } from "./admin-overview-client";
import { apiQueryKeys } from "./query-keys";

export function useAdminOverviewQuery(period: AdminOverviewPeriod = "30D") {
  return useQuery({
    queryKey: apiQueryKeys.admin.overview(period),
    queryFn: () => fetchAdminOverview(period),
  });
}
