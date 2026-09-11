"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  discardAdminCorpusVersion,
  fetchAdminCorpusVersion,
  fetchAdminCorpusVersions,
} from "./admin-corpus-versions-client";
import { apiQueryKeys } from "./query-keys";
export function useAdminCorpusVersionsQuery() {
  return useQuery({
    queryKey: apiQueryKeys.admin.corpusVersions(),
    queryFn: fetchAdminCorpusVersions,
  });
}
export function useAdminCorpusVersionQuery(versionId: string) {
  return useQuery({
    queryKey: apiQueryKeys.admin.corpusVersion(versionId),
    queryFn: () => fetchAdminCorpusVersion(versionId),
    enabled: Boolean(versionId),
  });
}
export function useDiscardAdminCorpusVersionMutation(versionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => discardAdminCorpusVersion(versionId),
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
