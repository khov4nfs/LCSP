import type {
  AdminSuspendUserInput,
  AdminRestoreUserInput,
  AdminInviteUserInput,
  AdminInvitationResult,
  AdminUserDetail,
  AdminUserListQuery,
  AdminUserListResponse,
} from "@lcsp/contracts/auth";
import {
  ADMIN_ACCOUNT_FILTERS,
  ADMIN_ACCOUNT_ERRORS,
} from "@lcsp/contracts/auth";
import { apiRequest } from "./api-request";

export async function fetchAdminUsersList(
  query: AdminUserListQuery = {},
): Promise<AdminUserListResponse> {
  const params = new URLSearchParams();
  if (query.query) params.set("q", query.query);
  if (query.status && query.status !== ADMIN_ACCOUNT_FILTERS.all)
    params.set("status", query.status);
  if (query.role && query.role !== ADMIN_ACCOUNT_FILTERS.all)
    params.set("role", query.role);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const result = await apiRequest(`/api/admin/users?${params}`);
  if (!result.ok)
    throw new Error(result.problemCode ?? ADMIN_ACCOUNT_ERRORS.invalidInput);
  return result.payload as AdminUserListResponse;
}
export async function fetchAdminUserDetail(
  id: string,
): Promise<AdminUserDetail> {
  const result = await apiRequest(`/api/admin/users/${encodeURIComponent(id)}`);
  if (!result.ok)
    throw new Error(result.problemCode ?? ADMIN_ACCOUNT_ERRORS.invalidInput);
  return result.payload as AdminUserDetail;
}
async function accountWrite<T>(
  path: string,
  input: unknown,
  idempotencyKey: string,
): Promise<T> {
  const result = await apiRequest(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  if (!result.ok)
    throw new Error(result.problemCode ?? ADMIN_ACCOUNT_ERRORS.invalidInput);
  return result.payload as T;
}
export function suspendAdminUser(
  id: string,
  input: AdminSuspendUserInput,
  key: string = crypto.randomUUID(),
): Promise<AdminUserDetail> {
  return accountWrite(
    `/api/admin/users/${encodeURIComponent(id)}/suspend`,
    input,
    key,
  );
}
export function restoreAdminUser(
  id: string,
  input: AdminRestoreUserInput,
  key: string = crypto.randomUUID(),
): Promise<AdminUserDetail> {
  return accountWrite(
    `/api/admin/users/${encodeURIComponent(id)}/restore`,
    input,
    key,
  );
}
export function createAdminUserInvitation(
  input: AdminInviteUserInput,
  key: string = crypto.randomUUID(),
): Promise<AdminInvitationResult> {
  return accountWrite("/api/admin/users", input, key);
}
