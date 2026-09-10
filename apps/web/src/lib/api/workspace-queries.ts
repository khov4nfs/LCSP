"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createAssessment,
  deleteAssessment,
  getAssessments,
  getWorkspace,
  renameAssessment,
  getWorkspaceSelection,
  persistWorkspaceSelection,
} from "./workspace-client";
import { apiQueryKeys } from "./query-keys";

export function useWorkspaceQuery() {
  return useQuery({
    queryKey: apiQueryKeys.workspace.detail(),
    queryFn: getWorkspace,
  });
}

export function useAssessmentsQuery() {
  return useQuery({
    queryKey: apiQueryKeys.workspace.assessments(),
    queryFn: getAssessments,
  });
}

export function useCreateAssessmentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      name,
      description,
    }: {
      name: string;
      description?: string;
    }) => createAssessment(name, description),
    onSuccess: async (outcome) => {
      if (outcome.kind !== "created") {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.workspace.assessments(),
      });
    },
  });
}

export function useRenameAssessmentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      assessmentId,
      name,
    }: {
      assessmentId: string;
      name: string;
    }) => renameAssessment(assessmentId, name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.workspace.assessments(),
      });
    },
  });
}

export function useDeleteAssessmentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (assessmentId: string) => deleteAssessment(assessmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.workspace.assessments(),
      });
    },
  });
}

export function useWorkspaceSelectionQuery() {
  return useQuery({
    queryKey: apiQueryKeys.workspace.selection(),
    queryFn: getWorkspaceSelection,
  });
}

export function usePersistWorkspaceSelectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: persistWorkspaceSelection,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.workspace.detail(),
      });
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.workspace.selection(),
      });
    },
  });
}
