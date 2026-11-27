import { signUpSchema as baseSignUpSchema } from "@lcsp/contracts/auth";
import { z } from "zod";

export const signUpSchema = baseSignUpSchema
  .extend({
    // Keep contract limits and normalization while replacing Zod defaults with locale-aware user feedback.
    display_name: z
      .string()
      .trim()
      .min(1, "pages.signUp.errors.displayNameRequired")
      .max(
        baseSignUpSchema.shape.display_name.maxLength ?? 100,
        "pages.signUp.errors.displayNameTooLong",
      ),
    email: z
      .string()
      .trim()
      .min(1, "pages.signUp.errors.emailRequired")
      .email("pages.signUp.errors.emailInvalid"),
    password: z
      .string()
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
