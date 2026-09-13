"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  discardAdminCorpusVersion,
  fetchAdminCorpusVersion,
  fetchAdminCorpusVersions,
  publishAdminCorpusVersion,
  prepareAdminCorpusVersion,
} from "./admin-corpus-versions-client";
import { apiQueryKeys } from "./query-keys";
export function useAdminCorpusVersionsQuery(params?: {
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: [...apiQueryKeys.admin.corpusVersions(), params ?? {}],
    queryFn: () => fetchAdminCorpusVersions(params),
  });
}

export function usePublishAdminCorpusVersionMutation(versionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      publishAdminCorpusVersion(versionId, idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.corpusVersions(),
      });
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.corpusVersion(versionId),
      });
    },
  });
}
export function useAdminCorpusVersionQuery(versionId: string) {
  return useQuery({
    queryKey: apiQueryKeys.admin.corpusVersion(versionId),
    queryFn: () => fetchAdminCorpusVersion(versionId),
    enabled: Boolean(versionId),
  });
}
export function usePrepareAdminCorpusVersionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      prepareAdminCorpusVersion(idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.corpusVersions(),
      });
    },
  });
}
export function useDiscardAdminCorpusVersionMutation(versionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      discardAdminCorpusVersion(versionId, idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.corpusVersions(),
      });
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.admin.corpusVersion(versionId),
      });
    },
  });
}
