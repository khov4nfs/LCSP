import { confirmPasswordRecoveryObjectSchema } from "@lcsp/contracts/auth";
import { z } from "zod";

export const recoveryConfirmSchema = z.object({
  token: z.string().min(1, "pages.recoveryConfirm.errors.tokenRequired"),
  new_password: confirmPasswordRecoveryObjectSchema.shape.new_password.min(
    confirmPasswordRecoveryObjectSchema.shape.new_password.minLength ?? 12,
    "pages.recoveryConfirm.errors.passwordTooShort",
  ),
});

export type RecoveryConfirmFormValues = z.infer<typeof recoveryConfirmSchema>;
