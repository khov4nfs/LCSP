import { requestPasswordRecoverySchema as baseRequestPasswordRecoverySchema } from "@lcsp/contracts/auth";
import { z } from "zod";

export const recoveryRequestSchema = baseRequestPasswordRecoverySchema.extend({
  email: baseRequestPasswordRecoverySchema.shape.email
    .min(1, "pages.recoveryRequest.errors.emailRequired")
    .email("pages.recoveryRequest.errors.emailInvalid"),
});

export type RecoveryRequestFormValues = z.infer<typeof recoveryRequestSchema>;
