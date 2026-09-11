import { z } from "zod";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
export const adminInviteUserSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => !/[\r\n\x00]/.test(value)),
  email: z.string().trim().email().max(254),
  role: z.enum([AUTH_USER_ROLES.admin, AUTH_USER_ROLES.customer]),
});
export type AdminInviteUserValues = z.infer<typeof adminInviteUserSchema>;
