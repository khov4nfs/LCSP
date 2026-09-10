"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminSuspendUserInput,
  AdminUpdateRoleInput,
  AdminUserListQuery,
} from "@lcsp/contracts/auth";

import {
  fetchAdminUserDetail,
  fetchAdminUsersList,
  suspendAdminUser,
  updateAdminUserRole,
} from "./admin-users-client";
import { apiQueryKeys } from "./query-keys";

export function useAdminUsersListQuery(query: AdminUserListQuery = {}) {
  return useQuery({
    queryKey: apiQueryKeys.admin.usersList(query as Record<string, unknown>),
    queryFn: () => fetchAdminUsersList(query),
  });
}

export function useAdminUserDetailQuery(userId: string) {
  return useQuery({
    queryKey: apiQueryKeys.admin.userDetail(userId),
    queryFn: () => fetchAdminUserDetail(userId),
    enabled: Boolean(userId),
  });
}

export function useAdminUpdateRoleMutation(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AdminUpdateRoleInput) =>
      updateAdminUserRole(userId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.userDetail(userId),
      });
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.usersRoot(),
      });
    },
  });
}

export function useAdminSuspendUserMutation(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input?: AdminSuspendUserInput) =>
      suspendAdminUser(userId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.userDetail(userId),
      });
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.usersRoot(),
      });
    },
  });
}
