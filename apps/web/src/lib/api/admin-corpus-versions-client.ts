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
export const fetchAdminCorpusVersions = (params?: {
  page?: number;
  pageSize?: number;
}) => {
  const query = new URLSearchParams();
  if (params?.page) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));
  return request<AdminCorpusVersionsListResponse>(
    `/api/admin/corpus-versions${query.size ? `?${query}` : ""}`,
  );
};
export const fetchAdminCorpusVersion = (versionId: string) =>
  request<AdminCorpusVersionDetail>(
    `/api/admin/corpus-versions/${encodeURIComponent(versionId)}`,
  );
export const prepareAdminCorpusVersion = (idempotencyKey: string) =>
  request<{ id: string; corpusVersionId: string; status: string }>(
    "/api/admin/corpus-versions/prepare",
    {
      method: "POST",
      body: JSON.stringify({ idempotencyKey }),
      headers: { "content-type": "application/json" },
    },
  );
export const discardAdminCorpusVersion = (
  versionId: string,
  idempotencyKey: string,
) =>
  request<AdminCorpusVersionDetail>(
    `/api/admin/corpus-versions/${encodeURIComponent(versionId)}/discard`,
    {
      method: "POST",
      body: JSON.stringify({ idempotencyKey }),
      headers: { "content-type": "application/json" },
    },
  );

export const publishAdminCorpusVersion = (
  versionId: string,
  idempotencyKey: string,
) =>
  request<AdminCorpusVersionDetail>(
    `/api/admin/corpus-versions/${encodeURIComponent(versionId)}/publish`,
    {
      method: "POST",
      body: JSON.stringify({ idempotencyKey }),
      headers: { "content-type": "application/json" },
    },
  );
