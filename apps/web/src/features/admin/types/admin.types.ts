import type {
  AdminUserDetail,
  AdminUserSummary,
  AuthAccountStatus,
  AuthUserRole,
} from "@lcsp/contracts/auth";

export type AdminUserFiltersState = {
  searchQuery: string;
  statusFilter: AuthAccountStatus | "ALL";
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
  onStatusChange: (status: AuthAccountStatus | "ALL") => void;
  onRoleChange: (role: AuthUserRole | "ALL") => void;
  onCreateUserClick?: () => void;
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
  onRoleSave: (newRole: AuthUserRole) => Promise<void>;
  onOpenSuspendModal: () => void;
  isSavingRole?: boolean;
};

export type AdminUsageSummaryProps = {
  usageSummary?: AdminUserDetail["usageSummary"];
};

export type AdminSuspendModalProps = {
  isOpen: boolean;
  user: Pick<AdminUserDetail, "id" | "fullName" | "email">;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isPending?: boolean;
};
