import { PREPAID_BILLING_CONFIG } from "@lcsp/contracts/billing";
import { z } from "zod";

const minimumAmount = Number(PREPAID_BILLING_CONFIG.minimumAmountVnd);
const maximumAmount = Number(PREPAID_BILLING_CONFIG.maximumAmountVnd);
const amountStep = Number(PREPAID_BILLING_CONFIG.amountStepVnd);

export const billingTopUpSchema = z.object({
  amountVnd: z
    .string()
    .trim()
    .regex(/^\d+$/)
    .refine((value) => {
      const amount = Number(value);
      return (
        amount >= minimumAmount &&
        amount <= maximumAmount &&
        amount % amountStep === 0
      );
    }),
});

export type BillingTopUpFormValues = z.infer<typeof billingTopUpSchema>;
