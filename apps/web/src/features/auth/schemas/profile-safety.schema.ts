import { updateProfileSchema as baseUpdateProfileSchema } from "@lcsp/contracts/auth";
import { z } from "zod";

export const profileSafetySchema = z.object({
  recovery_email: baseUpdateProfileSchema.shape.recovery_email
    .unwrap()
    .refine((val) => val === "" || z.string().email().safeParse(val).success, {
      message: "pages.workspace.security.errors.recoveryEmailInvalid",
    }),
});

export type ProfileSafetyFormValues = z.infer<typeof profileSafetySchema>;
