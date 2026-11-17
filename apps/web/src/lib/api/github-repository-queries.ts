"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  configureProviderCredential,
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

export function useConfigureProviderCredentialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: configureProviderCredential,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.githubIntegration.providerCredentials(),
      });
    },
  });
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
