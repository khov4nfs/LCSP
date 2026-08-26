"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type AuthSessionSummary,
  type AuthSettingsProfile,
  confirmPasswordRecovery,
  disableMfa,
  enrollMfa,
  getAuthRepositories,
  getAuthSessions,
  getAuthSettingsProfile,
  recordMfaRecoveryCodeAccess,
  reauthenticateWithPassword,
  revokeAuthSession,
  requestPasswordRecovery,
  signUp,
  signOut,
  updateProfile,
  verifyMfaRecoveryCode,
  verifyMfaOtp,
} from "./auth-client";
import { signIn } from "./sign-in-client";
import { API_OUTCOME_KINDS } from "./outcome-kinds";
import { apiQueryKeys } from "./query-keys";

export function useSignInMutation() {
  return useMutation({ mutationFn: signIn });
}

export function useSignUpMutation() {
  return useMutation({ mutationFn: signUp });
}

export function useAuthSettingsProfileQuery() {
  return useQuery({
    queryKey: apiQueryKeys.auth.settingsProfile(),
    queryFn: getAuthSettingsProfile,
  });
}

export function useAuthSessionsQuery() {
  return useQuery({
    queryKey: apiQueryKeys.auth.sessions(),
    queryFn: getAuthSessions,
  });
}

export function useAuthRepositoriesQuery() {
  return useQuery({
    queryKey: apiQueryKeys.auth.repositories(),
    queryFn: getAuthRepositories,
  });
}

export function useMfaVerifyMutation() {
  return useMutation({ mutationFn: verifyMfaOtp });
}

export function useMfaRecoveryCodeVerifyMutation() {
  return useMutation({ mutationFn: verifyMfaRecoveryCode });
}

export function usePasswordReauthMutation() {
  return useMutation({ mutationFn: reauthenticateWithPassword });
}

export function useMfaEnrollMutation() {
  return useMutation({ mutationFn: enrollMfa });
}

export function useMfaRecoveryCodeAccessMutation() {
  return useMutation({ mutationFn: recordMfaRecoveryCodeAccess });
}

export function useDisableMfaMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disableMfa,
    onSuccess: async (outcome) => {
      if (outcome.kind !== API_OUTCOME_KINDS.disabled) {
        return;
      }

      const currentProfile = queryClient.getQueryData<AuthSettingsProfile>(
        apiQueryKeys.auth.settingsProfile(),
      );
      if (currentProfile) {
        queryClient.setQueryData<AuthSettingsProfile>(
          apiQueryKeys.auth.settingsProfile(),
          {
            ...currentProfile,
            mfa_enrolled: false,
            mfa_enrolled_at: null,
            mfa_verified: false,
            mfa_verified_at: null,
          },
        );
      }

      const currentSessions = queryClient.getQueryData<AuthSessionSummary[]>(
        apiQueryKeys.auth.sessions(),
      );
      if (currentSessions) {
        queryClient.setQueryData<AuthSessionSummary[]>(
          apiQueryKeys.auth.sessions(),
          currentSessions.map((session) =>
            session.is_current
              ? { ...session, mfa_verified_at: null }
              : session,
          ),
        );
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.auth.settingsProfile(),
        }),
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.auth.sessions(),
        }),
      ]);
    },
  });
}

export function useRequestRecoveryMutation() {
  return useMutation({ mutationFn: requestPasswordRecovery });
}

export function useConfirmRecoveryMutation() {
  return useMutation({ mutationFn: confirmPasswordRecovery });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProfile,
    onSuccess: async (outcome) => {
      if (outcome.kind !== "saved") {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.auth.settingsProfile(),
      });
    },
  });
}

export function useSignOutMutation() {
  return useMutation({ mutationFn: signOut });
}

export function useRevokeAuthSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeAuthSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.auth.sessions(),
      });
    },
  });
}
