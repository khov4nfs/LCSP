import { billingAmountVndSchema } from "@lcsp/contracts/billing";
import { z } from "zod";

export const billingTopUpSchema = z.object({
  amountVnd: z
    .string()
    .trim()
    .refine((value) => billingAmountVndSchema.safeParse(value).success, {
      message: "pages.workspace.settingsHub.billing.amountInvalid",
    }),
});

export type BillingTopUpFormValues = z.infer<typeof billingTopUpSchema>;
