import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
} from "@lcsp/contracts/auth";
import type { FormSelectOption } from "@/components/types/form-select-field.types";

export const PRIMARY_EMAIL_OPTIONS = [
  {
    value: AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.accountEmail,
    labelKey: "pages.workspace.settingsHub.accountSecurity.accountEmail",
  },
  {
    value: AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail,
    labelKey: "pages.workspace.settingsHub.accountSecurity.recoveryEmail",
  },
] as const satisfies readonly FormSelectOption[];

export const BACKUP_EMAIL_OPTIONS = [
  {
    value: AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail,
    labelKey: "pages.workspace.settingsHub.accountSecurity.recoveryEmail",
  },
  {
    value: AUTH_BACKUP_EMAIL_POLICIES.allVerified,
    labelKey: "pages.workspace.settingsHub.accountSecurity.allVerified",
  },
] as const satisfies readonly FormSelectOption[];

export const ACCOUNT_SECURITY_ACTIONS = {
  disable: "DISABLE",
  regenerate: "REGENERATE",
} as const;
