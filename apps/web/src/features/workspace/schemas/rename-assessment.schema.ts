import { ASSESSMENT_NAME_MAX_LENGTH } from "@lcsp/contracts/assessment";
import { z } from "zod";

/**
 * Validation schema for RenameAssessmentDialog aligned with backend max length
 * and Frame 60 empty-name validation requirement.
 */
export const renameAssessmentFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "nameRequired")
    .max(ASSESSMENT_NAME_MAX_LENGTH, "nameTooLong"),
});

export type RenameAssessmentFormValues = z.infer<
  typeof renameAssessmentFormSchema
>;
