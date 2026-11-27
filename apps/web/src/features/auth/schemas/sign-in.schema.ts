import { signInSchema as baseSignInSchema } from "@lcsp/contracts/auth";
import { z } from "zod";

export const signInSchema = baseSignInSchema.extend({
  // Re-declare the contract's trim/email checks so both client-side failures resolve through the active EN/VI message keys.
  email: z
    .string()
    .trim()
    .min(1, "pages.signIn.errors.emailRequired")
    .email("pages.signIn.errors.emailInvalid"),
  password: z.string().min(1, "pages.signIn.errors.passwordRequired"),
});

export type SignInFormValues = z.infer<typeof signInSchema>;
