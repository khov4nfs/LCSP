import { signUpSchema as baseSignUpSchema } from "@lcsp/contracts/auth";
import { z } from "zod";

export const signUpSchema = baseSignUpSchema
  .extend({
    display_name: baseSignUpSchema.shape.display_name.min(
      1,
      "pages.signUp.errors.displayNameRequired",
    ),
    email: baseSignUpSchema.shape.email
      .min(1, "pages.signUp.errors.emailRequired")
      .email("pages.signUp.errors.emailInvalid"),
    password: baseSignUpSchema.shape.password
      .min(1, "pages.signUp.errors.passwordRequired")
      .min(
        baseSignUpSchema.shape.password.minLength ?? 12,
        "pages.signUp.errors.passwordTooShort",
      ),
    confirm_password: z
      .string()
      .min(1, "pages.signUp.errors.confirmPasswordRequired"),
  })
  .refine((values) => values.password === values.confirm_password, {
    path: ["confirm_password"],
    message: "pages.signUp.errors.passwordMismatch",
  });

export type SignUpFormValues = z.infer<typeof signUpSchema>;
