import type { REQUIRED_ACTIONS } from "./actions.ts";
import type { AUTH_BACKUP_EMAIL_POLICIES } from "./backup-email-policy.ts";
import type { AUTH_ERROR_CODES, SIGN_UP_ERROR_CODES } from "./codes.ts";
import type {
  AUTH_MEMBERSHIP_STATUSES,
  WORKSPACE_CAPABILITY_SOURCES,
} from "./states.ts";
import type { AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES } from "./primary-email-address-policy.ts";
import type { AUTH_USER_ROLES } from "./roles.ts";

export type RequiredAction =
  (typeof REQUIRED_ACTIONS)[keyof typeof REQUIRED_ACTIONS];

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export type SignUpErrorCode =
  (typeof SIGN_UP_ERROR_CODES)[keyof typeof SIGN_UP_ERROR_CODES];

export type WorkspaceCapabilitySource =
  (typeof WORKSPACE_CAPABILITY_SOURCES)[keyof typeof WORKSPACE_CAPABILITY_SOURCES];

export type AuthMembershipStatus =
  (typeof AUTH_MEMBERSHIP_STATUSES)[keyof typeof AUTH_MEMBERSHIP_STATUSES];

export type AuthBackupEmailPolicy =
  (typeof AUTH_BACKUP_EMAIL_POLICIES)[keyof typeof AUTH_BACKUP_EMAIL_POLICIES];

export type AuthPrimaryEmailAddressPolicy =
  (typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES)[keyof typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES];

export type AuthUserRole =
  (typeof AUTH_USER_ROLES)[keyof typeof AUTH_USER_ROLES];
