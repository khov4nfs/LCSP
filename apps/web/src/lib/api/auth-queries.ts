"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type AuthSessionSummary,
  type AuthSettingsProfile,
  confirmPasswordRecovery,
  disableMfa,
  enrollMfa,
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

/**
 * Business purpose: Query the authenticated user profile for account and security settings surfaces.
 *
 * Business rules:
 * - Allow callers to gate query execution using the optional enabled flag.
 * - Cache profile under the shared auth settings query key for cross-surface consistency.
 *
 * Execution flow:
 * 1. Read caller options including conditional enabled flag.
 * 2. Delegate query execution to getAuthSettingsProfile through TanStack Query.
 * 3. Return the reactive query outcome.
 *
 * Failure cases:
 * - Query failure when unauthenticated or during unauthorized profile fetch surfaces through query error state.
 *
 * Side effects:
 * - None: read-only query that populates TanStack Query cache.
 */
export function useAuthSettingsProfileQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: apiQueryKeys.auth.settingsProfile(),
    queryFn: getAuthSettingsProfile,
    ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}

export function useAuthSessionsQuery() {
  return useQuery({
    queryKey: apiQueryKeys.auth.sessions(),
    queryFn: getAuthSessions,
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

function useDisableMfaMutation() {
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

function useUpdateProfileMutation() {
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
