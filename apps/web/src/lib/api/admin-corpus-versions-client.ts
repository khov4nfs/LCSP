import type {
  AdminCorpusVersionDetail,
  AdminCorpusVersionsListResponse,
} from "@lcsp/contracts/legal-rule-catalog";
import { apiRequest } from "./api-request";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiRequest(path, init);
  if (!response.ok)
    throw new Error(response.problemCode ?? "ADMIN_CORPUS_VERSIONS_FAILED");
  return response.payload as T;
}
export const fetchAdminCorpusVersions = () =>
  request<AdminCorpusVersionsListResponse>("/api/admin/corpus-versions");
export const fetchAdminCorpusVersion = (versionId: string) =>
  request<AdminCorpusVersionDetail>(
    `/api/admin/corpus-versions/${encodeURIComponent(versionId)}`,
  );
export const discardAdminCorpusVersion = (versionId: string) =>
  request<AdminCorpusVersionDetail>(
    `/api/admin/corpus-versions/${encodeURIComponent(versionId)}/discard`,
    { method: "POST" },
  );
