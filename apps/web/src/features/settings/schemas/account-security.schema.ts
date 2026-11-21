import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
} from "@lcsp/contracts/auth";
import { z } from "zod";

export const accountSecuritySchema = z
  .object({
    recovery_email: z
      .string()
      .trim()
      .toLowerCase()
      .refine(
        (value) => value === "" || z.email().safeParse(value).success,
        "pages.workspace.security.errors.recoveryEmailInvalid",
      ),
    primary_email_address_policy: z.enum(
      Object.values(AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES),
    ),
    backup_recovery_email_policy: z.enum(
      Object.values(AUTH_BACKUP_EMAIL_POLICIES),
    ),
  })
  .refine(
    (value) =>
      value.primary_email_address_policy !==
        AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail ||
      value.recovery_email !== "",
    {
      path: ["recovery_email"],
      message: "pages.workspace.settingsHub.accountSecurity.emailRequired",
    },
  );

export type AccountSecurityValues = z.infer<typeof accountSecuritySchema>;
