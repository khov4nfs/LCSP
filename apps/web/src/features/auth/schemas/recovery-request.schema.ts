import { requestPasswordRecoverySchema as baseRequestPasswordRecoverySchema } from "@lcsp/contracts/auth";
import { z } from "zod";

export const recoveryRequestSchema = baseRequestPasswordRecoverySchema.extend({
  // Preserve contract normalization while returning localized format errors for the auth field component.
  email: z
    .string()
    .trim()
    .min(1, "pages.recoveryRequest.errors.emailRequired")
    .email("pages.recoveryRequest.errors.emailInvalid"),
});

export type RecoveryRequestFormValues = z.infer<typeof recoveryRequestSchema>;
