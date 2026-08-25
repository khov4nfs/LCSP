import { z } from "zod";

const MIN_PASSWORD_LENGTH = 12;

export const signUpSchema = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(1, "pages.signUp.errors.displayNameRequired"),
    organization_name: z
      .string()
      .trim()
      .min(1, "pages.signUp.errors.organizationNameRequired"),
    email: z
      .string()
      .trim()
      .min(1, "pages.signUp.errors.emailRequired")
      .email("pages.signUp.errors.emailInvalid"),
    password: z
      .string()
      .min(1, "pages.signUp.errors.passwordRequired")
      .min(MIN_PASSWORD_LENGTH, "pages.signUp.errors.passwordTooShort"),
    confirm_password: z
      .string()
      .min(1, "pages.signUp.errors.confirmPasswordRequired"),
  })
  .refine((values) => values.password === values.confirm_password, {
    path: ["confirm_password"],
    message: "pages.signUp.errors.passwordMismatch",
  });

export type SignUpFormValues = z.infer<typeof signUpSchema>;
