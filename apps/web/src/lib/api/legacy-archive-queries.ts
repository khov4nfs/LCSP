"use client";
import { useQuery } from "@tanstack/react-query";
import { legacyArchiveDetailSchema } from "@lcsp/contracts/legacy-migration";
import { apiValidated } from "./api-request";

export const legacyArchiveKeys = {
  detail: (id: string) => ["legacy-archive", id, "detail"] as const,
};

/** Archived V1 assessment detail; a 404 problem means "this assessment is not archived". */
export function useLegacyArchiveDetailQuery(id: string) {
  return useQuery({
    queryKey: legacyArchiveKeys.detail(id),
    queryFn: () =>
      apiValidated(
        `/api/legacy-archive/assessments/${encodeURIComponent(id)}`,
        legacyArchiveDetailSchema,
      ),
    enabled: Boolean(id),
    retry: false,
  });
}
