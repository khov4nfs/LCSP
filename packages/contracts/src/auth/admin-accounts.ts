import type { AuthUserRole } from "./types.ts";

/** Durable product access state; never derived from a security lockout. */
export const USER_ACCESS_STATUSES = {
  active: "ACTIVE",
  suspended: "SUSPENDED",
} as const;
export type UserAccessStatus =
  (typeof USER_ACCESS_STATUSES)[keyof typeof USER_ACCESS_STATUSES];
export const ADMIN_ACCOUNT_REFERENCE_TYPES = {
  user: "USER",
  invitation: "INVITATION",
} as const;
export const ACCOUNT_INVITATION_STATUSES = {
  pending: "PENDING",
  accepted: "ACCEPTED",
  revoked: "REVOKED",
} as const;
export const INVITATION_DELIVERY_STATUSES = {
  pending: "PENDING",
  sent: "SENT",
  failed: "FAILED",
} as const;
export const ADMIN_ACCOUNT_OPERATIONS = {
  suspend: "SUSPEND",
  restore: "RESTORE",
  invite: "INVITE",
} as const;
export type AdminAccountOperation =
  (typeof ADMIN_ACCOUNT_OPERATIONS)[keyof typeof ADMIN_ACCOUNT_OPERATIONS];
export const ADMIN_ACCOUNT_QUERY_LIMITS = {
  defaultPageSize: 20,
  maxPageSize: 100,
  maxPage: 10000,
  maxQueryLength: 200,
} as const;
export const ADMIN_ACCOUNT_FILTERS = { all: "ALL" } as const;
export const ADMIN_ACCOUNT_ERRORS = {
  invalidInput: "ADMIN_ACCOUNT_INVALID_INPUT",
  staleVersion: "ADMIN_ACCOUNT_STALE_VERSION",
  staleInvitation: "ADMIN_INVITATION_STALE_GENERATION",
  invalidState: "ADMIN_ACCOUNT_INVALID_STATE",
  lastUsableAdmin: "LAST_USABLE_ADMIN_REQUIRED",
  selfSuspend: "CANNOT_SUSPEND_SELF",
  idempotencyRequired: "ADMIN_IDEMPOTENCY_KEY_REQUIRED",
  idempotencyConflict: "ADMIN_IDEMPOTENCY_KEY_CONFLICT",
  concurrentChange: "ADMIN_ACCOUNT_CONCURRENT_CHANGE",
  duplicateAccount: "ADMIN_ACCOUNT_EMAIL_EXISTS",
  duplicateInvitation: "ADMIN_INVITATION_ALREADY_PENDING",
  invalidInvitation: "INVITATION_INVALID_OR_EXPIRED",
  invitationUnavailable: "ADMIN_INVITATION_DELIVERY_UNAVAILABLE",
  invitationDeliveryFailed: "ADMIN_INVITATION_DELIVERY_FAILED",
  invitationDeliveryPending: "ADMIN_INVITATION_DELIVERY_PENDING",
  accountSuspended: "ACCOUNT_SUSPENDED",
} as const;
export type AdminAccountReferenceType =
  (typeof ADMIN_ACCOUNT_REFERENCE_TYPES)[keyof typeof ADMIN_ACCOUNT_REFERENCE_TYPES];
export type InvitationDeliveryStatus =
  (typeof INVITATION_DELIVERY_STATUSES)[keyof typeof INVITATION_DELIVERY_STATUSES];
export interface AdminRestoreUserInput {
  expectedVersion: number;
  reason?: string;
}
export interface AdminInviteUserInput {
  email: string;
  displayName: string;
  role: AuthUserRole;
}
export interface AcceptAccountInvitationInput {
  token: string;
  password: string;
}
export interface AdminInvitationResult {
  id: string;
  referenceType: typeof ADMIN_ACCOUNT_REFERENCE_TYPES.invitation;
  email: string;
  fullName: string;
  role: AuthUserRole;
  expiresAt: string;
  deliveryStatus: InvitationDeliveryStatus;
  replayed: boolean;
}
