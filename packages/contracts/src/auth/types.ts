import type { REQUIRED_ACTIONS } from "./actions.ts";
import type { AUTH_BACKUP_EMAIL_POLICIES } from "./backup-email-policy.ts";
import type {
  ACCEPT_INVITATION_ERROR_CODES,
  AUTH_ERROR_CODES,
  INVITE_DEVELOPER_ERROR_CODES,
  REVOKE_MEMBERSHIP_ERROR_CODES,
  SIGN_UP_ERROR_CODES,
} from "./codes.ts";
import type {
  AUTH_INVITATION_STATES,
  AUTH_MEMBERSHIP_STATUSES,
  WORKSPACE_CAPABILITY_SOURCES,
} from "./states.ts";
import type { AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES } from "./primary-email-address-policy.ts";

export type RequiredAction =
  (typeof REQUIRED_ACTIONS)[keyof typeof REQUIRED_ACTIONS];

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export type AcceptInvitationErrorCode =
  (typeof ACCEPT_INVITATION_ERROR_CODES)[keyof typeof ACCEPT_INVITATION_ERROR_CODES];

export type SignUpErrorCode =
  (typeof SIGN_UP_ERROR_CODES)[keyof typeof SIGN_UP_ERROR_CODES];

export type InviteDeveloperErrorCode =
  (typeof INVITE_DEVELOPER_ERROR_CODES)[keyof typeof INVITE_DEVELOPER_ERROR_CODES];

export type RevokeMembershipErrorCode =
  (typeof REVOKE_MEMBERSHIP_ERROR_CODES)[keyof typeof REVOKE_MEMBERSHIP_ERROR_CODES];

export type AuthMembershipStatus =
  (typeof AUTH_MEMBERSHIP_STATUSES)[keyof typeof AUTH_MEMBERSHIP_STATUSES];

export type AuthInvitationState =
  (typeof AUTH_INVITATION_STATES)[keyof typeof AUTH_INVITATION_STATES];

export type WorkspaceCapabilitySource =
  (typeof WORKSPACE_CAPABILITY_SOURCES)[keyof typeof WORKSPACE_CAPABILITY_SOURCES];

export type AuthBackupEmailPolicy =
  (typeof AUTH_BACKUP_EMAIL_POLICIES)[keyof typeof AUTH_BACKUP_EMAIL_POLICIES];

export type AuthPrimaryEmailAddressPolicy =
  (typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES)[keyof typeof AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES];
