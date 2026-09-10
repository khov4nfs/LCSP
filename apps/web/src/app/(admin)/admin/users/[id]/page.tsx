"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";
import type { AuthUserRole } from "@lcsp/contracts/auth";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminPageHeader } from "@/features/admin/components/molecules/admin-page-header";
import { AdminStatusBadge } from "@/features/admin/components/atoms/admin-status-badge";
import { AdminAccountDetailsCard } from "@/features/admin/components/organisms/admin-account-details-card";
import { AdminAdministrativeActionsCard } from "@/features/admin/components/organisms/admin-administrative-actions-card";
import { AdminUsageSummary } from "@/features/admin/components/organisms/admin-usage-summary";
import { AdminSuspendModal } from "@/features/admin/components/organisms/admin-suspend-modal";
import {
  useAdminSuspendUserMutation,
  useAdminUpdateRoleMutation,
  useAdminUserDetailQuery,
} from "@/lib/api/admin-users-queries";
import { resolveAppMessage } from "@/lib/i18n";

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [isSuspendModalOpen, setIsSuspendModalOpen] = useState(false);

  const { data: user, isLoading, error } = useAdminUserDetailQuery(id);
  const updateRoleMutation = useAdminUpdateRoleMutation(id);
  const suspendUserMutation = useAdminSuspendUserMutation(id);

  const pageTitle = resolveAppMessage(
    "pages.admin.userDetail.title" as MessageKey,
  );
  const pageDescription = resolveAppMessage(
    "pages.admin.userDetail.description" as MessageKey,
  );
  const backToUsersLabel = resolveAppMessage(
    "pages.admin.userDetail.backToUsers" as MessageKey,
  );
  const defaultSuspendReason = resolveAppMessage(
    "pages.admin.suspendModal.defaultReason" as MessageKey,
  );

  const handleRoleSave = async (newRole: AuthUserRole) => {
    await updateRoleMutation.mutateAsync({ role: newRole });
  };

  const handleConfirmSuspend = async () => {
    await suspendUserMutation.mutateAsync({ reason: defaultSuspendReason });
    setIsSuspendModalOpen(false);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col space-y-6 pb-12">
        <Skeleton className="h-10 w-48 bg-muted" />
        <Skeleton className="h-6 w-96 bg-muted" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-[252px] w-full rounded-xl bg-muted" />
          <Skeleton className="h-[252px] w-full rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-base font-semibold text-foreground">
          {resolveAppMessage("pages.admin.usersList.errorTitle" as MessageKey)}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/users")}
          className="mt-4 rounded-[10px]"
        >
          {backToUsersLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-6 pb-12">
      {/* Page Header */}
      <AdminPageHeader
        title={pageTitle}
        description={pageDescription}
      />

      {/* Back Button */}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/users")}
          className="h-[38px] w-auto px-3.5 rounded-[10px] border-border bg-secondary text-[12.5px] font-semibold text-secondary-foreground hover:bg-secondary/80 shadow-xs"
        >
          <ArrowLeftIcon className="size-4 mr-1.5" />
          {backToUsersLabel}
        </Button>
      </div>

      {/* User Identity Header + Status Pill */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-col space-y-1">
          <h2 className="text-[24px] font-semibold text-foreground tracking-tight">
            {user.fullName}
          </h2>
          <span className="text-[12.5px] text-muted-foreground">
            {user.email}
          </span>
        </div>

        {/* Status Pill */}
        <AdminStatusBadge status={user.status} size="md" />
      </div>

      {/* Two Details / Actions Cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdminAccountDetailsCard user={user} />
        <AdminAdministrativeActionsCard
          user={user}
          onRoleSave={handleRoleSave}
          onOpenSuspendModal={() => setIsSuspendModalOpen(true)}
          isSavingRole={updateRoleMutation.isPending}
        />
      </div>

      {/* Usage Summary */}
      <AdminUsageSummary usageSummary={user.usageSummary} />

      {/* Suspend Confirmation Modal */}
      <AdminSuspendModal
        isOpen={isSuspendModalOpen}
        user={user}
        onClose={() => setIsSuspendModalOpen(false)}
        onConfirm={handleConfirmSuspend}
        isPending={suspendUserMutation.isPending}
      />
    </div>
  );
}
