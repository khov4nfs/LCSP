import type {
  AdminUserDetail,
  AdminUserSummary,
  AuthUserRole,
  UserAccessStatus,
} from "@lcsp/contracts/auth";

type AdminUserFiltersState = {
  searchQuery: string;
  statusFilter: UserAccessStatus | "ALL";
  roleFilter: AuthUserRole | "ALL";
};

export type AdminUsersTableProps = {
  users: AdminUserSummary[];
  isLoading?: boolean;
  onViewUser: (userId: string) => void;
};

export type AdminUserFiltersProps = {
  filters: AdminUserFiltersState;
  onSearchChange: (value: string) => void;
  onStatusChange: (status: UserAccessStatus | "ALL") => void;
  onRoleChange: (role: AuthUserRole | "ALL") => void;
};

export type AdminPaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  disabled?: boolean;
};

export type AdminAccountDetailsCardProps = {
  user: AdminUserDetail;
};

export type AdminAdministrativeActionsCardProps = {
  user: AdminUserDetail;
  onOpenSuspendModal: () => void;
  onRestore?: () => Promise<void>;
  isRestoring?: boolean;
};

export type AdminUsageSummaryProps = {
  usageSummary?: AdminUserDetail["usageSummary"];
};

export type AdminSuspendModalProps = {
  isOpen: boolean;
  user: Pick<AdminUserDetail, "id" | "fullName" | "email">;
  errorMessage?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isPending?: boolean;
};
