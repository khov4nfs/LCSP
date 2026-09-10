import type {
  AdminSuspendUserInput,
  AdminUpdateRoleInput,
  AdminUserDetail,
  AdminUserListQuery,
  AdminUserListResponse,
} from "@lcsp/contracts/auth";

import { apiRequest } from "./api-request";

/**
 * Fetches the paginated and filtered list of user accounts for Admin view.
 */
export async function fetchAdminUsersList(
  query: AdminUserListQuery = {},
): Promise<AdminUserListResponse> {
  const searchParams = new URLSearchParams();
  if (query.query) searchParams.set("query", query.query);
  if (query.status && query.status !== "ALL") searchParams.set("status", query.status);
  if (query.role && query.role !== "ALL") searchParams.set("role", query.role);
  if (query.page) searchParams.set("page", String(query.page));
  if (query.pageSize) searchParams.set("pageSize", String(query.pageSize));

  const queryString = searchParams.toString();
  const url = queryString ? `/api/admin/users?${queryString}` : "/api/admin/users";

  const response = await apiRequest(url);
  if (!response.ok) {
    throw new Error(response.problemCode ?? "FETCH_ADMIN_USERS_FAILED");
  }
  return response.payload as AdminUserListResponse;
}

/**
 * Fetches authoritative user detail with 30-day usage summary for Admin.
 */
export async function fetchAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail> {
  const response = await apiRequest(`/api/admin/users/${userId}`);
  if (!response.ok) {
    throw new Error(response.problemCode ?? "FETCH_ADMIN_USER_DETAIL_FAILED");
  }
  return response.payload as AdminUserDetail;
}

/**
 * Mutates a user's role (promote/demote) with backend safeguards.
 */
export async function updateAdminUserRole(
  userId: string,
  input: AdminUpdateRoleInput,
): Promise<AdminUserDetail> {
  const response = await apiRequest(`/api/admin/users/${userId}/role`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(response.problemCode ?? "UPDATE_ADMIN_USER_ROLE_FAILED");
  }
  return response.payload as AdminUserDetail;
}

/**
 * Suspends a user account and triggers session revocation.
 */
export async function suspendAdminUser(
  userId: string,
  input?: AdminSuspendUserInput,
): Promise<AdminUserDetail> {
  const response = await apiRequest(`/api/admin/users/${userId}/suspend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!response.ok) {
    throw new Error(response.problemCode ?? "SUSPEND_ADMIN_USER_FAILED");
  }
  return response.payload as AdminUserDetail;
}

