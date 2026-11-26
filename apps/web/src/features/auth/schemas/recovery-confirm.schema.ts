import { confirmPasswordRecoveryObjectSchema } from "@lcsp/contracts/auth";
import { z } from "zod";

// The confirmation value is presentation-only: it improves recovery form feedback while the server contract still receives only token and new_password.
export const recoveryConfirmSchema = z
  .object({
    token: z.string().min(1, "pages.recoveryConfirm.errors.tokenRequired"),
    // Reuse the contract's password length while replacing its default error with the localized auth message key.
    new_password: z
      .string()
      .min(
        confirmPasswordRecoveryObjectSchema.shape.new_password.minLength ?? 12,
        "pages.recoveryConfirm.errors.passwordTooShort",
      ),
    confirm_new_password: z
      .string()
      .min(1, "pages.recoveryConfirm.errors.confirmPasswordRequired"),
  })
  .refine((values) => values.new_password === values.confirm_new_password, {
    path: ["confirm_new_password"],
    message: "pages.recoveryConfirm.errors.passwordMismatch",
  });

export type RecoveryConfirmFormValues = z.infer<typeof recoveryConfirmSchema>;
