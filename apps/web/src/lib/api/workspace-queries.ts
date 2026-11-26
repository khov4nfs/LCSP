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

/**
 * Business purpose: Provide a mutation hook for renaming an assessment across workspace and tracking views.
 * Business rules:
 * - Only authenticated users with assessment write access may rename an assessment.
 * - Both workspace assessment list and tracking caches must be invalidated on success.
 * Execution flow:
 * 1. Register a React Query mutation that invokes `renameAssessment(assessmentId, name)`.
 * 2. Invalidate workspace assessments and tracking caches once the rename succeeds.
 * Failure cases:
 * - BFF validation or authorization errors reject the mutation for dialog error rendering.
 * Side effects:
 * - Issues a PATCH BFF request and invalidates React Query caches on success.
 */
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
    /**
     * Business purpose: Refresh workspace and tracking assessment lists after a rename succeeds.
     * Business rules:
     * - Invalidate both `workspace.assessments` and `tracking` query namespaces.
     * Execution flow:
     * 1. Await parallel invalidation of workspace assessments and tracking queries.
     * Failure cases:
     * - Query invalidation errors propagate to React Query's mutation lifecycle.
     * Side effects:
     * - Marks cached assessment and tracking queries stale to trigger background refetch.
     */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.workspace.assessments(),
        }),
        queryClient.invalidateQueries({
          queryKey: ["tracking"],
        }),
      ]);
    },
  });
}

/**
 * Business purpose: Provide a mutation hook for permanently deleting an assessment.
 * Business rules:
 * - Deletion is irreversible and must refresh both workspace and tracking caches on success.
 * Execution flow:
 * 1. Register a React Query mutation that invokes `deleteAssessment(assessmentId)`.
 * 2. Invalidate workspace assessments and tracking caches once deletion succeeds.
 * Failure cases:
 * - BFF or authorization failures reject the mutation so the confirmation dialog retains error state.
 * Side effects:
 * - Issues a DELETE BFF request and invalidates React Query caches on success.
 */
export function useDeleteAssessmentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (assessmentId: string) => deleteAssessment(assessmentId),
    /**
     * Business purpose: Remove deleted assessment entries from cached workspace and tracking views.
     * Business rules:
     * - Invalidate both `workspace.assessments` and `tracking` query namespaces.
     * Execution flow:
     * 1. Await parallel invalidation of workspace assessments and tracking queries.
     * Failure cases:
     * - Query invalidation errors propagate to React Query's mutation lifecycle.
     * Side effects:
     * - Marks cached assessment and tracking queries stale to trigger background refetch.
     */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.workspace.assessments(),
        }),
        queryClient.invalidateQueries({
          queryKey: ["tracking"],
        }),
      ]);
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
