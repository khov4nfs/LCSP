import { Injectable } from "@nestjs/common";
import { z } from "zod";

import type { AssessmentRuntimeErasurePort } from "../../application/ports/assessment-runtime-erasure.port.js";

const erasureResultSchema = z.strictObject({ erased: z.literal(true) });

@Injectable()
export class AgentServerAssessmentErasure implements AssessmentRuntimeErasurePort {
  async erase(input: {
    assessmentId: string;
    ownerId: string;
    threadId: string;
  }): Promise<void> {
    const baseUrl = process.env.LCSP_AGENT_SERVER_URL;
    const key = process.env.WORKER_API_KEY;
    if (!baseUrl || !key)
      throw new Error("Assessment runtime erasure is not configured");
    const response = await fetch(
      new URL("/internal/assessment-erasure", baseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Api-Key": key,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(40_000),
      },
    );
    if (!response.ok)
      throw new Error("Assessment runtime erasure did not complete");
    erasureResultSchema.parse(await response.json());
  }
}
