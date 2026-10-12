import { signInSchema as baseSignInSchema } from "@lcsp/contracts/auth";
import { z } from "zod";

export const signInSchema = baseSignInSchema.extend({
  email: baseSignInSchema.shape.email
    .min(1, "pages.signIn.errors.emailRequired")
    .email("pages.signIn.errors.emailInvalid"),
  password: baseSignInSchema.shape.password.min(
    1,
    "pages.signIn.errors.passwordRequired",
  ),
});

export type SignInFormValues = z.infer<typeof signInSchema>;
