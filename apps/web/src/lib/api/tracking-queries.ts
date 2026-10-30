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
  /**
   * Business purpose: Keep overview caches separate by search text and display locale.
   * Business rules:
   * - Reuse an overview only when search and locale match; pagination is added by the hook.
   * Execution flow:
   * 1. Build a stable key from the overview namespace, search, and current locale.
   * Failure cases:
   * - Invalid search input is handled by the request contract, not the cache key.
   * Side effects:
   * - None: constructs a cache identity without requesting data.
   */
  overview: (search: string) =>
    ["tracking", "overview", search, getAppLocaleSnapshot()] as const,
  /**
   * Business purpose: Isolate obligation summaries for each requested customer filter set.
   * Business rules:
   * - Distinct paging and filter values must not share a summary cache entry.
   * Execution flow:
   * 1. Place the obligation query under its tracking cache namespace.
   * Failure cases:
   * - Invalid filters are rejected by the API query contract during loading.
   * Side effects:
   * - None: constructs a cache identity without requesting data.
   */
  obligations: (query: CustomerTrackingListQuery) =>
    ["tracking", "obligations", query] as const,
  /**
   * Business purpose: Isolate Final Report lists for each requested customer filter set.
   * Business rules:
   * - Distinct paging and freshness values must not share a report cache entry.
   * Execution flow:
   * 1. Place the report query under its tracking cache namespace.
   * Failure cases:
   * - Invalid filters are rejected by the API query contract during loading.
   * Side effects:
   * - None: constructs a cache identity without requesting data.
   */
  reports: (query: CustomerTrackingListQuery) =>
    ["tracking", "reports", query] as const,
  admin: ["tracking", "admin-operational"] as const,
};

/**
 * Business purpose: Preserve selected tracking filters when requesting paged customer data.
 * Business rules:
 * - Omit absent and empty values so the server applies its documented defaults.
 * Execution flow:
 * 1. Serialize supplied filter values and return a query suffix only when values remain.
 * Failure cases:
 * - Unsupported values are rejected by the route contract after serialization.
 * Side effects:
 * - None: builds a URL suffix without making a request.
 */
function queryString(
  values: Record<string, string | number | boolean | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.size ? `?${params.toString()}` : "";
}

/**
 * Business purpose: Subscribe the workspace dashboard to its customer tracking overview.
 * Business rules:
 * - Search, locale, and offset identify the cache entry; the overview requests a recent 30-day change window.
 * Execution flow:
 * 1. Register a query keyed by search, locale, and offset with its overview loader.
 * Failure cases:
 * - Request and schema failures surface as query errors rather than empty dashboard data.
 * Side effects:
 * - Registers a React Query subscription; the loader performs a read-only BFF request.
 */
export function useCustomerTrackingOverviewQuery(search = "", offset = 0) {
  const locale = getAppLocaleSnapshot();
  return useQuery({
    queryKey: [...trackingKeys.overview(search), offset],
    /**
     * Business purpose: Load the current page of customer actions, changes, and assessment status.
     * Business rules:
     * - Request at most 50 assessments and eight actions and changes from the recent window.
     * Execution flow:
     * 1. Calculate the window start, serialize overview parameters, and validate the BFF response.
     * Failure cases:
     * - Transport, API, and contract errors reject the query for the dashboard to display.
     * Side effects:
     * - Performs one read-only BFF request; does not change assessments.
     */
    queryFn: () => {
      const since = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const params = queryString({
        limit: 50,
        offset,
        actionsLimit: 8,
        changesLimit: 8,
        search: search || undefined,
        since,
        locale,
      });
      return apiValidated(
        `/api/assessments/tracking/overview${params}`,
        customerTrackingOverviewSchema,
      );
    },
  });
}

/**
 * Business purpose: Subscribe the compliance view to a filtered obligation summary.
 * Business rules:
 * - Cache entries follow the requested filters and default to 50 groups per page.
 * Execution flow:
 * 1. Serialize filters and register a query under the obligation cache key.
 * Failure cases:
 * - Request or contract validation failures surface as query errors.
 * Side effects:
 * - Registers a React Query subscription; its loader reads the BFF.
 */
export function useCustomerTrackingObligationsQuery(
  query: CustomerTrackingListQuery = {},
) {
  const params = queryString({ ...query, limit: query.limit ?? 50 });
  return useQuery({
    queryKey: trackingKeys.obligations(query),
    /**
     * Business purpose: Retrieve the requested obligation summary page for the customer.
     * Business rules:
     * - Response data must satisfy the obligation summary contract before display.
     * Execution flow:
     * 1. Request the serialized filters and validate the returned summary.
     * Failure cases:
     * - API, transport, or schema failures reject the query.
     * Side effects:
     * - Performs one read-only BFF request without changing obligation decisions.
     */
    queryFn: () =>
      apiValidated(
        `/api/assessments/tracking/obligations${params}`,
        customerTrackingObligationsSchema,
      ),
  });
}

/**
 * Business purpose: Subscribe an obligation drill-down to its owner-scoped assessment page.
 * Business rules:
 * - Group identity and filters identify the cache entry; loading can be disabled until the panel opens.
 * Execution flow:
 * 1. Apply the default page size and register the conditional detail query.
 * Failure cases:
 * - Request and response contract failures surface as query errors.
 * Side effects:
 * - Registers a React Query subscription; loading makes a read-only BFF request.
 */
export function useCustomerTrackingObligationAssessmentsQuery(
  query: CustomerTrackingObligationAssessmentsQuery,
  enabled = true,
) {
  const params = queryString({ ...query, limit: query.limit ?? 20 });
  return useQuery({
    queryKey: ["tracking", "obligation-assessments", query],
    /**
     * Business purpose: Load the assessments behind one selected obligation group.
     * Business rules:
     * - Returned assessment details must match the shared drill-down response schema.
     * Execution flow:
     * 1. Request the selected group page and validate the returned assessments.
     * Failure cases:
     * - API, transport, or schema errors reject the query.
     * Side effects:
     * - Performs one read-only BFF request without changing decisions.
     */
    queryFn: () =>
      apiValidated(
        `/api/assessments/tracking/obligations/assessments${params}`,
        customerTrackingObligationAssessmentsSchema,
      ),
    enabled,
  });
}

/**
 * Business purpose: Subscribe an expandable obligation drill-down to successive assessment pages.
 * Business rules:
 * - The initial offset and shared page size govern loading; no further page is requested after hasMore is false.
 * Execution flow:
 * 1. Register an infinite query for the selected group and derive each next offset from server pagination.
 * Failure cases:
 * - Failed page requests remain query errors and do not become fabricated rows.
 * Side effects:
 * - Registers a React Query subscription; page loaders make read-only BFF requests.
 */
export function useCustomerTrackingObligationAssessmentsPages(
  query: CustomerTrackingObligationAssessmentsQuery,
  initialOffset: number,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["tracking", "obligation-assessments-pages", query],
    initialPageParam: initialOffset,
    /**
     * Business purpose: Load one additional page of assessments for the selected obligation.
     * Business rules:
     * - Use the server-provided page offset and validate every returned page.
     * Execution flow:
     * 1. Serialize the group filters with the page offset and request the detail projection.
     * Failure cases:
     * - API, transport, or schema errors reject the page request.
     * Side effects:
     * - Performs one read-only BFF request without changing assessments.
     */
    queryFn: ({ pageParam }) => {
      const params = queryString({
        ...query,
        limit: query.limit ?? 20,
        offset: pageParam,
      });
      return apiValidated(
        `/api/assessments/tracking/obligations/assessments${params}`,
        customerTrackingObligationAssessmentsSchema,
      );
    },
    /**
     * Business purpose: Stop obligation pagination at the exact server-reported end.
     * Business rules:
     * - Advance by the returned limit only when hasMore is true.
     * Execution flow:
     * 1. Read the last page's pagination and return its next offset or no page token.
     * Failure cases:
     * - A false hasMore value ends loading rather than requesting beyond the total.
     * Side effects:
     * - None: computes a page token from an already validated response.
     */
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
    enabled,
  });
}

/**
 * Business purpose: Subscribe the Reports view to filtered customer Final Reports.
 * Business rules:
 * - Requested filters identify the cache entry and the default page size is 50.
 * Execution flow:
 * 1. Serialize report filters and register the corresponding query.
 * Failure cases:
 * - Failed requests or invalid response data surface as query errors.
 * Side effects:
 * - Registers a React Query subscription; loading reads the BFF.
 */
export function useCustomerTrackingReportsQuery(
  query: CustomerTrackingListQuery = {},
) {
  const params = queryString({ ...query, limit: query.limit ?? 50 });
  return useQuery({
    queryKey: trackingKeys.reports(query),
    /**
     * Business purpose: Retrieve a validated page of customer Final Reports.
     * Business rules:
     * - Only data matching the shared report contract is eligible for display.
     * Execution flow:
     * 1. Request the selected report page and validate the response.
     * Failure cases:
     * - API, transport, or schema failures reject the report query.
     * Side effects:
     * - Performs one read-only BFF request without changing artifacts.
     */
    queryFn: () =>
      apiValidated(
        `/api/assessments/tracking/reports${params}`,
        customerTrackingReportsSchema,
      ),
  });
}

/**
 * Business purpose: Subscribe Admin tracking to the platform operational projection.
 * Business rules:
 * - The Admin cache key is separate from customer tracking data; upstream authorization governs access.
 * Execution flow:
 * 1. Register the operational query under its Admin cache identity.
 * Failure cases:
 * - Authorization, transport, and schema failures surface as query errors.
 * Side effects:
 * - Registers a React Query subscription; loading reads the Admin BFF route.
 */
export function useAdminTrackingOperationalQuery() {
  return useQuery({
    queryKey: trackingKeys.admin,
    /**
     * Business purpose: Retrieve the Admin operational tracking snapshot for display.
     * Business rules:
     * - Validate the result against the operational schema before exposing metrics.
     * Execution flow:
     * 1. Request the Admin BFF endpoint and parse its response.
     * Failure cases:
     * - Denied access, upstream failure, or invalid data rejects the query.
     * Side effects:
     * - Performs one read-only BFF request without changing platform state.
     */
    queryFn: () =>
      apiValidated(
        "/api/admin/tracking/operational",
        adminTrackingOperationalSchema,
      ),
  });
}
