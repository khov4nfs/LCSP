"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  disconnectProviderCredential,
  getProviderCredentialStatuses,
  getRepositoryConnections,
  connectGitHubRepository,
  discoverGitHubRepositories,
} from "./github-repository-client";
import { apiQueryKeys } from "./query-keys";

export function useRepositoryConnectionsQuery() {
  return useQuery({
    queryKey: apiQueryKeys.githubIntegration.repositories(),
    queryFn: getRepositoryConnections,
  });
}

/**
 * Business purpose: Confirm the saved provider status using a fresh Settings read.
 * Business rules:
 * - A pre-save request cannot be used as confirmation of a PAT write.
 * Execution flow:
 * 1. Cancel older reads for the status key and fetch its current value.
 * Failure cases:
 * - A read error propagates so the dialog can offer a read-only retry.
 * Side effects:
 * - Updates the shared provider-status query without storing any submitted PAT.
 */
export function useRefreshProviderCredentialStatuses() {
  const queryClient = useQueryClient();

  return async () => {
    const queryKey = apiQueryKeys.githubIntegration.providerCredentials();
    // Cancel a pre-save read before requesting authoritative status for the acknowledgement.
    await queryClient.cancelQueries({ queryKey, exact: true });
    return queryClient.fetchQuery({
      queryKey,
      queryFn: getProviderCredentialStatuses,
      staleTime: 0,
      retry: false,
    });
  };
}

/**
 * Business purpose: Disconnect a provider credential and refresh every view that depends on it.
 * Business rules:
 * - Cached provider statuses and repository connections are refreshed before the caller sees success.
 * Execution flow:
 * 1. Run the disconnect request, then invalidate the credential and repository queries and wait for refetch.
 * Failure cases:
 * - A failed request skips invalidation and leaves cached state unchanged.
 * Side effects:
 * - Mutates the backend credential and refreshes TanStack Query caches.
 */
export function useDisconnectProviderCredentialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectProviderCredential,
    /**
     * Business purpose: Reflect backend-confirmed disconnect in cached Settings data.
     * Business rules:
     * - Only runs after the backend acknowledged the disconnect.
     * Execution flow:
     * 1. Invalidate provider credential and repository connection queries together.
     * Failure cases:
     * - Refetch failures surface through the queries' own error states.
     * Side effects:
     * - Triggers refetches of both queries.
     */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.githubIntegration.providerCredentials(),
        }),
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.githubIntegration.repositories(),
        }),
      ]);
    },
  });
}

export function useProviderCredentialStatusesQuery() {
  return useQuery({
    queryKey: apiQueryKeys.githubIntegration.providerCredentials(),
    queryFn: getProviderCredentialStatuses,
  });
}

export function useDiscoverGitHubRepositoriesMutation() {
  return useMutation({ mutationFn: discoverGitHubRepositories });
}

export function useConnectGitHubRepositoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: connectGitHubRepository,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.githubIntegration.repositories(),
        }),
      ]);
    },
  });
}
