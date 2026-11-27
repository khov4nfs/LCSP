"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@lcsp/i18n";
import type { AuthUserRole, UserAccessStatus } from "@lcsp/contracts/auth";

import { AdminPageHeader } from "@/features/admin/components/molecules/admin-page-header";
import { AdminUserInsightStrip } from "@/features/admin/components/molecules/admin-user-insight-strip";
import { AdminUserFilters } from "@/features/admin/components/molecules/admin-user-filters";
import { AdminUserTable } from "@/features/admin/components/organisms/admin-user-table";
import { AdminPagination } from "@/features/admin/components/molecules/admin-pagination";
import { useAdminUsersListQuery } from "@/lib/api/admin-users-queries";
import { resolveAppMessage } from "@/lib/i18n";

export default function AdminUsersPage() {
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserAccessStatus | "ALL">(
    "ALL",
  );
  const [roleFilter, setRoleFilter] = useState<AuthUserRole | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data, isLoading } = useAdminUsersListQuery({
    query: searchQuery,
    status: statusFilter,
    role: roleFilter,
    page,
    pageSize,
  });

  const pageTitle = resolveAppMessage(
    "pages.admin.usersList.title" as MessageKey,
  );
  const pageDescription = resolveAppMessage(
    "pages.admin.usersList.description" as MessageKey,
  );

  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const users = data?.users ?? [];

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setPage(1);
  };

  const handleStatusChange = (status: UserAccessStatus | "ALL") => {
    setStatusFilter(status);
    setPage(1);
  };

  const handleRoleChange = (role: AuthUserRole | "ALL") => {
    setRoleFilter(role);
    setPage(1);
  };

  const handleViewUser = (userId: string) => {
    router.push(`/admin/users/${userId}`);
  };

  return (
    <div
      data-figma-node="1662:3013"
      data-figma-name="45 Admin · User accounts"
      className="flex flex-col space-y-6 pb-12"
    >
      {/* Page Header */}
      <AdminPageHeader title={pageTitle} description={pageDescription} />

      {/* Collection Insight Strip */}
      <AdminUserInsightStrip
        totalCount={totalCount || 876}
        activeCount={842}
        suspendedCount={34}
        newCount={36}
      />

      {/* Users Table with embedded DataTableToolbar and Pagination */}
      <AdminUserTable
        users={users}
        isLoading={isLoading}
        onViewUser={handleViewUser}
        totalCount={totalCount}
        toolbarSlot={
          <AdminUserFilters
            filters={{
              searchQuery,
              statusFilter,
              roleFilter,
            }}
            onSearchChange={handleSearchChange}
            onStatusChange={handleStatusChange}
            onRoleChange={handleRoleChange}
          />
        }
        paginationSlot={
          <AdminPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        }
      />
    </div>
  );
}
