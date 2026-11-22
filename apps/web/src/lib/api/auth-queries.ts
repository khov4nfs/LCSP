"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type UpdateProfileRequest,
  confirmPasswordRecovery,
  disableMfa,
  enrollMfa,
  generateMfaRecoveryCodes,
  getAuthSessions,
  getAuthSettingsProfile,
  recordMfaRecoveryCodeAccess,
  reauthenticateWithPassword,
  revokeAuthSession,
  revokeAllAuthSessions,
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
import type { WorkspaceOutcome } from "@/features/workspace/types/workspace.types";

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

/**
 * Business purpose: Start authenticator enrollment without retaining setup credentials after use.
 * Business rules:
 * - Enrollment writes must not retry automatically because they rotate setup credentials.
 * Execution flow:
 * 1. Expose enrollment with immediate garbage collection once the consumer resets or unmounts.
 * Failure cases:
 * - Network failures remain uncertain writes for the owning setup interaction to resolve.
 * Side effects:
 * - Requests a new TOTP setup and recovery-code batch through the backend.
 */
export function useMfaEnrollMutation() {
  return useMutation({ mutationFn: enrollMfa, retry: false, gcTime: 0 });
}

export function useMfaRecoveryCodeAccessMutation() {
  return useMutation({ mutationFn: recordMfaRecoveryCodeAccess });
}

/**
 * Business purpose: Publish disabled MFA only after reading the persisted account state.
 * Business rules:
 * - Rejected or challenged requests do not change security caches.
 * - A successful delete must be confirmed by the profile API before reporting completion.
 * Execution flow:
 * 1. Disable the current account's factor and read its persisted profile.
 * 2. Reject inconsistent confirmation and refresh session proof metadata.
 * Failure cases:
 * - Transport failures or an enabled factor after deletion reject the mutation.
 * Side effects:
 * - Deletes MFA through the API and refreshes profile and sessions caches.
 */
export function useDisableMfaMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disableMfa,
    retry: false,
    /**
     * Business purpose: Confirm MFA removal before exposing disabled security state.
     * Business rules:
     * - Only an acknowledged deletion triggers confirmation; fabricated cache values are prohibited.
     * Execution flow:
     * 1. Cancel older profile reads and read persisted enrollment and current-session proof after deletion.
     * 2. Reject active factor metadata and refresh session summaries on confirmation.
     * Failure cases:
     * - Read failure or retained MFA metadata rejects completion without claiming success.
     * Side effects:
     * - Reads profile and refreshes authenticated session caches.
     */
    onSuccess: async (outcome) => {
      if (outcome.kind !== API_OUTCOME_KINDS.disabled) {
        return;
      }

      await queryClient.cancelQueries({
        queryKey: apiQueryKeys.auth.settingsProfile(),
      });
      const profile = await queryClient.fetchQuery({
        queryKey: apiQueryKeys.auth.settingsProfile(),
        queryFn: getAuthSettingsProfile,
        staleTime: 0,
        retry: false,
      });
      if (profile.mfa_enrolled || profile.mfa_verified) {
        throw new Error("mfa-disable-not-confirmed");
      }
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.auth.sessions(),
      });
    },
  });
}

/**
 * Business purpose: Expose replacement recovery codes only for the active security interaction.
 * Business rules:
 * - Do not retry ambiguous batch replacement or retain cleartext results after reset/unmount.
 * Execution flow:
 * 1. Delegate one replacement attempt to the authenticated domain client.
 * Failure cases:
 * - Backend challenges and transport errors remain available to the owning section.
 * Side effects:
 * - Requests recovery-code replacement; mutation cache entries are immediately collectible.
 */
export function useGenerateMfaRecoveryCodesMutation() {
  return useMutation({
    mutationFn: generateMfaRecoveryCodes,
    retry: false,
    gcTime: 0,
  });
}

export function useRequestRecoveryMutation() {
  return useMutation({ mutationFn: requestPasswordRecovery });
}

export function useConfirmRecoveryMutation() {
  return useMutation({ mutationFn: confirmPasswordRecovery });
}

/**
 * Business purpose: Publish confirmed profile changes to every cached account identity surface.
 * Business rules:
 * - Rejected saves leave identity caches unchanged; success requires a fresh profile read.
 * - Update workspace identity only when it belongs to the confirmed account.
 * Execution flow:
 * 1. Submit the profile patch and stop on a rejected outcome.
 * 2. Read the persisted profile and verify every requested identity or security field was retained.
 * 3. Replace matching cached workspace identity with the confirmed name.
 * Failure cases:
 * - Failed confirmation or a mismatched saved field rejects the mutation so the editor retains its draft.
 * Side effects:
 * - Saves through the backend and refreshes profile/workspace query caches.
 */
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProfile,
    /**
     * Business purpose: Synchronize account identity only after a persisted profile is confirmed.
     * Business rules:
     * - Rejected writes do not change identity; workspace cache updates require matching account IDs.
     * Execution flow:
     * 1. Cancel older reads, then read the saved profile and verify requested names, normalized recovery email and both policies.
     * 2. Refresh matching workspace identity with the confirmed profile name.
     * Failure cases:
     * - Failed reads and mismatched fields reject confirmation and leave the editor draft available.
     * Side effects:
     * - Reads the profile API and updates profile and workspace query caches.
     */
    onSuccess: async (outcome, request: UpdateProfileRequest) => {
      if (outcome.kind !== API_OUTCOME_KINDS.saved) {
        return;
      }

      await queryClient.cancelQueries({
        queryKey: apiQueryKeys.auth.settingsProfile(),
      });
      const profile = await queryClient.fetchQuery({
        queryKey: apiQueryKeys.auth.settingsProfile(),
        queryFn: getAuthSettingsProfile,
        staleTime: 0,
        retry: false,
      });
      if (
        (request.display_name !== undefined &&
          profile.display_name !== (request.display_name.trim() || null)) ||
        (request.recovery_email !== undefined &&
          profile.recovery_email !==
            (request.recovery_email.trim().toLowerCase() || null)) ||
        (request.primary_email_address_policy !== undefined &&
          profile.primary_email_address_policy !==
            request.primary_email_address_policy) ||
        (request.backup_recovery_email_policy !== undefined &&
          profile.backup_recovery_email_policy !==
            request.backup_recovery_email_policy)
      ) {
        throw new Error("profile-update-not-confirmed");
      }
      queryClient.setQueryData<WorkspaceOutcome>(
        apiQueryKeys.workspace.detail(),
        (current) =>
          current?.kind === API_OUTCOME_KINDS.loaded &&
          current.workspace.user.id === profile.user_id
            ? {
                ...current,
                workspace: {
                  ...current.workspace,
                  user: {
                    ...current.workspace.user,
                    display_name: profile.display_name ?? profile.email,
                  },
                },
              }
            : current,
      );
    },
  });
}

export function useSignOutMutation() {
  return useMutation({ mutationFn: signOut });
}

/**
 * Business purpose: Refresh session metadata after an acknowledged revocation.
 * Business rules:
 * - Failed and challenged mutations must not invalidate the list as though they succeeded.
 * Execution flow:
 * 1. Run the revocation client and refresh sessions only for a saved outcome.
 * Failure cases:
 * - Network failures remain mutation errors; read failures remain query errors.
 * Side effects:
 * - Sends revocation requests and invalidates the session query on completion.
 */
export function useRevokeAuthSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeAuthSession,
    /**
     * Business purpose: Synchronize the list after backend-confirmed session revocation.
     * Business rules:
     * - Authentication challenges and rejected mutations do not trigger success refreshes.
     * Execution flow:
     * 1. Check the outcome and invalidate the shared sessions query on saved.
     * Failure cases:
     * - Refresh failures remain section-local query errors.
     * Side effects:
     * - May refetch the authenticated session list.
     */
    onSuccess: async (outcome) => {
      if (outcome.kind !== API_OUTCOME_KINDS.saved) return;
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.auth.sessions(),
      });
    },
  });
}

/**
 * Business purpose: Expose the all-device logout request to Settings.
 * Business rules:
 * - Keep cache clearing and navigation in the owning interaction after confirmed success.
 * Execution flow:
 * 1. Delegate mutation execution to the shared all-sessions client.
 * Failure cases:
 * - Rejections and network failures are returned to the section without success effects.
 * Side effects:
 * - Initiates backend all-session revocation through the BFF.
 */
export function useRevokeAllAuthSessionsMutation() {
  return useMutation({ mutationFn: revokeAllAuthSessions });
}
