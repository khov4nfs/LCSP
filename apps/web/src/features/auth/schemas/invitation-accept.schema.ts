import { z } from "zod";
export const invitationAcceptSchema = z
  .object({
    password: z.string().min(12).max(256),
    confirmPassword: z.string().min(12).max(256),
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "pages.accountLifecycle.passwordMismatch",
  });
export type InvitationAcceptValues = z.infer<typeof invitationAcceptSchema>;
