"use client";

import { FormTextField } from "@/components/molecules/form-text-field";
import { FormSelectField } from "@/components/molecules/form-select-field";
import {
  PRIMARY_EMAIL_OPTIONS,
  BACKUP_EMAIL_OPTIONS,
} from "../../config/account-security.config";
import type { AccountSecurityValues } from "../../schemas/account-security.schema";

export function AccountEmailFields() {
  return (
    <div className="grid gap-4 sm:max-w-lg">
      <FormTextField<AccountSecurityValues>
        name="recovery_email"
        id="settings-recovery-email"
        type="email"
        autoComplete="email"
        labelKey="pages.workspace.settingsHub.accountSecurity.recoveryEmail"
      />
      <FormSelectField<AccountSecurityValues>
        name="primary_email_address_policy"
        id="settings-primary-email-policy"
        labelKey="pages.workspace.settingsHub.accountSecurity.primaryPolicy"
        options={PRIMARY_EMAIL_OPTIONS}
      />
      <FormSelectField<AccountSecurityValues>
        name="backup_recovery_email_policy"
        id="settings-backup-email-policy"
        labelKey="pages.workspace.settingsHub.accountSecurity.backupPolicy"
        options={BACKUP_EMAIL_OPTIONS}
      />
    </div>
  );
}
