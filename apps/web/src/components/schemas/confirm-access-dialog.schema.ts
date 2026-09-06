import { z } from "zod";

export const confirmAccessPasswordSchema = z.object({
  password: z.string().min(1, "pages.signIn.errors.passwordRequired"),
});

export const confirmAccessOtpSchema = z.object({
  otp: z
    .string()
    .trim()
    .min(1, "pages.mfaVerify.errors.otpRequired")
    .regex(/^\d{6}$/, "pages.mfaVerify.errors.otpInvalidFormat"),
});

export type ConfirmAccessPasswordValues = z.infer<
  typeof confirmAccessPasswordSchema
>;

export type ConfirmAccessOtpValues = z.infer<
  typeof confirmAccessOtpSchema
>;
