import { z } from "zod";

export const FEEDBACK_CATEGORIES = [
  "product",
  "compliance",
  "integration",
  "other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const feedbackFormSchema = z.object({
  name: z.string().trim().min(1, "pages.marketing.home.feedbackErrorNameRequired"),
  email: z
    .string()
    .trim()
    .min(1, "pages.marketing.home.feedbackErrorEmailInvalid")
    .email("pages.marketing.home.feedbackErrorEmailInvalid"),
  category: z.enum(FEEDBACK_CATEGORIES, {
    message: "pages.marketing.home.feedbackCategoryLabel",
  }),
  rating: z.number().int().min(1, "pages.marketing.home.feedbackErrorRatingRequired").max(5),
  message: z
    .string()
    .trim()
    .min(10, "pages.marketing.home.feedbackErrorMessageMin"),
});

export type FeedbackFormValues = z.infer<typeof feedbackFormSchema>;
