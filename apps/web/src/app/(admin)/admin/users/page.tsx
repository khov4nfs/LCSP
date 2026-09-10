"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MessageKey } from "@lcsp/i18n";
import type { AuthAccountStatus, AuthUserRole } from "@lcsp/contracts/auth";

import { AdminPageHeader } from "@/features/admin/components/molecules/admin-page-header";
import { AdminUserFilters } from "@/features/admin/components/molecules/admin-user-filters";
import { AdminUserTable } from "@/features/admin/components/organisms/admin-user-table";
import { AdminPagination } from "@/features/admin/components/molecules/admin-pagination";
import { useAdminUsersListQuery } from "@/lib/api/admin-users-queries";
import { resolveAppMessage } from "@/lib/i18n";

export default function AdminUsersPage() {
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AuthAccountStatus | "ALL">("ALL");
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
  const accountsCountTemplate = resolveAppMessage(
    "pages.admin.usersList.accountsCount" as MessageKey,
  );

  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const users = data?.users ?? [];

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setPage(1);
  };

  const handleStatusChange = (status: AuthAccountStatus | "ALL") => {
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
    <div className="flex flex-col space-y-6 pb-12">
      {/* Page Header */}
      <AdminPageHeader
        title={pageTitle}
        description={pageDescription}
      />

      {/* Filter Bar */}
      <div className="pt-2">
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
      </div>

      {/* Result Count */}
      <div className="pt-1">
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {accountsCountTemplate.replace("{count}", totalCount.toLocaleString())}
        </span>
      </div>

      {/* Users Table */}
      <AdminUserTable
        users={users}
        isLoading={isLoading}
        onViewUser={handleViewUser}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <AdminPagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          disabled={isLoading}
        />
      )}
    </div>
  );
}
