import type { Locale } from "@lcsp/contracts/shared";
import type {
  AuthSettingsProfile,
  DisableMfaOutcome,
  EnrollMfaOutcome,
} from "@/lib/api/auth-client";
import type { GenerateMfaRecoveryCodesOutcome } from "@/lib/api/types/mfa-recovery-codes.types";
import type { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import type { ACCOUNT_SECURITY_ACTIONS } from "../config/account-security.config";

export type AccountSecurityAction =
  (typeof ACCOUNT_SECURITY_ACTIONS)[keyof typeof ACCOUNT_SECURITY_ACTIONS];

export type AccountSecurityProps = {
  locale: Locale;
  onReauthenticate: (mfaRequired: boolean) => Promise<boolean>;
};

export type SecurityEditorProps = AccountSecurityProps & {
  profile: AuthSettingsProfile;
  readFailed: boolean;
};

export type AccountMfaSectionProps = SecurityEditorProps & {
  readVersion: number;
};

export type SecurityChallengeOutcome = {
  kind: (typeof API_OUTCOME_KINDS)[keyof typeof API_OUTCOME_KINDS];
};

export type AccountMfaOutcome =
  DisableMfaOutcome | EnrollMfaOutcome | GenerateMfaRecoveryCodesOutcome;

export type RecoveryCodesPanelProps = {
  codes: string[];
  locale: Locale;
  onClose: () => void;
};

export type MfaSetupProps = {
  totpUri: string;
  locale: Locale;
  onVerified: () => Promise<void>;
};

export type SecurityConfirmationProps = {
  action: AccountSecurityAction | null;
  locale: Locale;
  onCancel: () => void;
  onConfirm: (action: AccountSecurityAction) => void;
};
