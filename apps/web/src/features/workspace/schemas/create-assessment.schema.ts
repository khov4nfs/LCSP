export { createAssessmentSchema as createAssessmentFormSchema } from "@lcsp/contracts/assessment-domain";
import type { z } from "zod";
import type { createAssessmentSchema } from "@lcsp/contracts/assessment-domain";
export type CreateAssessmentFormValues = z.infer<typeof createAssessmentSchema>;
