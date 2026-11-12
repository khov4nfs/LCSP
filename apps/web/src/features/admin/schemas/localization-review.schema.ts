import { z } from "zod";
import { AUTHORED_SOURCE_LANGUAGES } from "@lcsp/contracts/assessment-domain";

export const localizationReviewFormSchema = z.object({
  evidence: z.string().trim().min(10).max(4000),
  confirmsIndividualFieldReview: z.boolean(),
  confirmsTargetLanguageAndMeaning: z.boolean(),
  items: z.array(
    z.object({
      requestId: z.string().min(1),
      selected: z.boolean(),
      sourceLanguage: z.enum(AUTHORED_SOURCE_LANGUAGES),
      normalizedContent: z.string(),
    }),
  ),
});

export type LocalizationReviewForm = z.infer<
  typeof localizationReviewFormSchema
>;
