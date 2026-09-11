import type { REQUIRED_ACTIONS } from "./actions.ts";
import type { AUTH_BACKUP_EMAIL_POLICIES } from "./backup-email-policy.ts";
import type {
  ADMIN_ERROR_CODES,
  AUTH_ERROR_CODES,
  SIGN_UP_ERROR_CODES,
} from "./codes.ts";
import type {
  AUTH_ACCOUNT_STATUSES,
  AUTH_MEMBERSHIP_STATUSES,
  WORKSPACE_CAPABILITY_SOURCES,
} from "./states.ts";
import type { AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES } from "./primary-email-address-policy.ts";
import type { AUTH_USER_ROLES } from "./roles.ts";

export type RequiredAction =
  (typeof REQUIRED_ACTIONS)[keyof typeof REQUIRED_ACTIONS];

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export type AdminErrorCode =
  (typeof ADMIN_ERROR_CODES)[keyof typeof ADMIN_ERROR_CODES];

export type SignUpErrorCode =
  (typeof SIGN_UP_ERROR_CODES)[keyof typeof SIGN_UP_ERROR_CODES];

export type WorkspaceCapabilitySource =
  (typeof WORKSPACE_CAPABILITY_SOURCES)[keyof typeof WORKSPACE_CAPABILITY_SOURCES];

export type AuthMembershipStatus =
  (typeof AUTH_MEMBERSHIP_STATUSES)[keyof typeof AUTH_MEMBERSHIP_STATUSES];

export type AuthAccountStatus =
  (typeof AUTH_ACCOUNT_STATUSES)[keyof typeof AUTH_ACCOUNT_STATUSES];

export type AuthBackupEmailPolicy =
  (typeof AUTH_BACKUP_EMAIL_POLICIES)[keyof typeof AUTH_BACKUP_EMAIL_POLICIES];

export type AuthPrimaryEmailAddressPolicy =
  (typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES)[keyof typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES];

export type AuthUserRole =
  (typeof AUTH_USER_ROLES)[keyof typeof AUTH_USER_ROLES];

export interface AdminUserSummary {
  /** Always returned by LCSP-299; optional for legacy UI fixtures. */
  version?: number;
  referenceType?: import("./admin-accounts.ts").AdminAccountReferenceType;
  id: string;
  fullName: string;
  email: string;
  role: AuthUserRole;
  status: AuthAccountStatus;
  createdAt: string;
  lastActiveAt: string | null;
  assessmentCount: number | null;
}

export interface AdminUserUsageSummary {
  assessments30d: number | null;
  lastAssessmentAt: string | null;
  creditSpend30d: number | null;
  openFindingsCount: number | null;
}

export interface AdminUserDetail {
  version?: number;
  referenceType?: import("./admin-accounts.ts").AdminAccountReferenceType;
  replayed?: boolean;
  invitationExpiresAt?: string;
  deliveryStatus?: import("./admin-accounts.ts").InvitationDeliveryStatus;
  id: string;
  fullName: string;
  email: string;
  role: AuthUserRole;
  status: AuthAccountStatus;
  createdAt: string;
  lastActiveAt: string | null;
  usageSummary: AdminUserUsageSummary;
}

export interface AdminUserListQuery {
  query?: string;
  status?: AuthAccountStatus | "ALL";
  role?: AuthUserRole | "ALL";
  page?: number;
  pageSize?: number;
}

export interface AdminUserListResponse {
  users: AdminUserSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminSuspendUserInput {
  expectedVersion: number;
  reason?: string;
}
