import type {
  AuthBackupEmailPolicy,
  AuthPrimaryEmailAddressPolicy,
  AuthUserRole,
} from "@lcsp/contracts/auth";

import type { AuthProblemResult } from "./common.contract.ts";

export type AuthProfileSuccess = {
  ok: true;
  user_id: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  recovery_email: string | null;
  primary_email_address_policy: AuthPrimaryEmailAddressPolicy;
  backup_recovery_email_policy: AuthBackupEmailPolicy;
  created_at: string;
  updated_at: string;
  role: AuthUserRole;
  mfa_enrolled: boolean;
  mfa_enrolled_at: string | null;
  mfa_verified: boolean;
  mfa_verified_at: string | null;
  current_session_id: string;
  current_session_created_at: string;
  current_session_updated_at: string;
  current_session_expires_at: string;
};

export type AuthSessionsSuccess = {
  ok: true;
  sessions: Array<{
    id: string;
    created_at: string;
    updated_at: string;
    expires_at: string;
    revoked_at: string | null;
    mfa_verified_at: string | null;
    is_current: boolean;
  }>;
};

export type AuthRepositoriesSuccess = {
  ok: true;
  repositories: Array<{
    id: string;
    installation_id: string;
    repository_name: string;
    repository_full_name: string;
    default_branch: string;
    status: string;
    connected_at: string;
    revoked_at: string | null;
    assessment_id: string | null;
    assessment_name: string | null;
  }>;
};

export type RevokeOwnedSessionSuccess = {
  ok: true;
  revoked_session_id: string;
};

export type AuthSettingsResponse =
  | AuthProblemResult
  | AuthProfileSuccess
  | AuthSessionsSuccess
  | AuthRepositoriesSuccess
  | RevokeOwnedSessionSuccess;
