import {
  type AssessmentRuntimeControlResult,
  isAssessmentRuntimeControlState,
} from "@lcsp/contracts/evidence";
import { apiRequest } from "./api-request";

export async function assessmentRuntimeControl(
  assessmentId: string,
  action: string,
  targetRunId?: string,
): Promise<AssessmentRuntimeControlResult | null> {
  const mutation = action !== "control";
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/runtime/${action}`,
    {
      method: mutation ? "POST" : "GET",
      ...(mutation
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetRunId }),
          }
        : {}),
    },
  );
  if (!response.ok)
    throw new Error(response.problemCode ?? "Runtime control request failed");
  const value = response.payload as AssessmentRuntimeControlResult | null;
  if (value === null) return null;
  if (
    !isAssessmentRuntimeControlState(value.state) ||
    typeof value.targetRunId !== "string" ||
    (value.requestId !== null && typeof value.requestId !== "string")
  )
    throw new Error("Invalid runtime control response");
  return value;
}
