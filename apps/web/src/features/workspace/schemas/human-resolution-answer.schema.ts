import { z } from "zod";
import { answerAssessmentHumanRequestSchema } from "@lcsp/contracts/assessment-domain";

export const humanResolutionAnswerFormSchema = z.discriminatedUnion(
  "doesNotKnow",
  [
    z.object({ doesNotKnow: z.literal(true), answer: z.string().optional() }),
    z.object({
      doesNotKnow: z.literal(false),
      answer: answerAssessmentHumanRequestSchema.options[1].shape.answer,
    }),
  ],
);
export type HumanResolutionAnswerFormValues = z.infer<
  typeof humanResolutionAnswerFormSchema
>;
