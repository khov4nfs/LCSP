"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  configureProviderCredential,
  getProviderCredentialStatuses,
  connectGitHubRepository,
  discoverGitHubRepositories,
} from "./github-repository-client";
import { apiQueryKeys } from "./query-keys";

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
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.auth.repositories(),
      });
    },
  });
}
