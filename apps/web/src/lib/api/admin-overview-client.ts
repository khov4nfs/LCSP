import type {
  AdminOverviewPeriod,
  AdminOverviewStats,
} from "@lcsp/contracts/auth";
import { apiRequest } from "./api-request";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiRequest(path, init);
  if (!response.ok) {
    throw new Error(response.problemCode ?? "ADMIN_OVERVIEW_FAILED");
  }
  return response.payload as T;
}

export const fetchAdminOverview = (period?: AdminOverviewPeriod) => {
  const query = period ? `?period=${encodeURIComponent(period)}` : "";
  return request<AdminOverviewStats>(`/api/admin/overview${query}`);
};
