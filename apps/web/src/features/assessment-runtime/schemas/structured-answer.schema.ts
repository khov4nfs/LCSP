import { z } from "zod";

/** Free-text answer: required, trimmed. The server still judges sufficiency. */
export const textAnswerFormSchema = z.object({
  answer: z.string().trim().min(1),
});
export type TextAnswerFormValues = z.infer<typeof textAnswerFormSchema>;
