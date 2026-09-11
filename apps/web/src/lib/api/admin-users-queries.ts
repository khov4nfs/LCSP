"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminSuspendUserInput,
  AdminRestoreUserInput,
  AdminInviteUserInput,
  AdminUserListQuery,
} from "@lcsp/contracts/auth";
import {
  fetchAdminUserDetail,
  fetchAdminUsersList,
  suspendAdminUser,
  restoreAdminUser,
  createAdminUserInvitation,
} from "./admin-users-client";
import { apiQueryKeys } from "./query-keys";

export function useAdminUsersListQuery(query: AdminUserListQuery = {}) {
  return useQuery({
    queryKey: apiQueryKeys.admin.usersList(query as Record<string, unknown>),
    queryFn: () => fetchAdminUsersList(query),
  });
}
export function useAdminUserDetailQuery(id: string) {
  return useQuery({
    queryKey: apiQueryKeys.admin.userDetail(id),
    queryFn: () => fetchAdminUserDetail(id),
    enabled: Boolean(id),
  });
}
type WithKey<T> = T & { idempotencyKey?: string };
function useAccountMutation<T>(
  id: string,
  execute: (id: string, input: T, key?: string) => Promise<unknown>,
) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...input }: WithKey<T>) =>
      execute(id, input as T, idempotencyKey),
    retry: false,
    onSettled: async () => {
      await cache.invalidateQueries({
        queryKey: apiQueryKeys.admin.usersRoot(),
      });
    },
  });
}
export function useAdminSuspendUserMutation(id: string) {
  return useAccountMutation<AdminSuspendUserInput>(id, suspendAdminUser);
}
export function useAdminRestoreUserMutation(id: string) {
  return useAccountMutation<AdminRestoreUserInput>(id, restoreAdminUser);
}
export function useAdminInviteUserMutation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...input }: WithKey<AdminInviteUserInput>) =>
      createAdminUserInvitation(input, idempotencyKey),
    retry: false,
    onSettled: async () => {
      await cache.invalidateQueries({
        queryKey: apiQueryKeys.admin.usersRoot(),
      });
    },
  });
}
