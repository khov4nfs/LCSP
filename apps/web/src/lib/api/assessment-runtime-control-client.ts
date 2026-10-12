import {
  assessmentRuntimeControlRequestSchema,
  assessmentRuntimeControlResultSchema,
} from "@lcsp/contracts/evidence";
import { apiValidated } from "./api-request";
export async function assessmentRuntimeControl(
  assessmentId: string,
  action: string,
  targetRunId?: string,
) {
  const mutation = action !== "control";
  return apiValidated(
    `/api/assessments/${encodeURIComponent(assessmentId)}/runtime/${action}`,
    assessmentRuntimeControlResultSchema.nullable(),
    {
      method: mutation ? "POST" : "GET",
      ...(mutation
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              assessmentRuntimeControlRequestSchema.parse({ targetRunId }),
            ),
          }
        : {}),
    },
  );
}
