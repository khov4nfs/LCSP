import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import type { AppConfig } from "../../../../config/config.types.js";
import type { AssessmentRuntimeErasurePort } from "../../application/ports/assessment-runtime-erasure.port.js";

const erasureResultSchema = z.strictObject({ erased: z.literal(true) });

@Injectable()
export class AgentServerAssessmentErasure implements AssessmentRuntimeErasurePort {
  constructor(
    @Optional()
    private readonly configService?: ConfigService<AppConfig>,
  ) {}

  async erase(input: {
    assessmentId: string;
    ownerId: string;
    threadId: string;
    correlationId?: string;
  }): Promise<void> {
    const baseUrl =
      this.configService?.get("agentServerUrl", { infer: true }) ||
      process.env.LCSP_AGENT_SERVER_URL;
    const key =
      this.configService?.get("worker", { infer: true })?.apiKey ||
      process.env.WORKER_API_KEY;
    if (!baseUrl || !key)
      throw new Error("Assessment runtime erasure is not configured");
    // Explanatory comment:
    // Forward X-Correlation-Id for distributed traceability and enforce 10s timeout to prevent hanging DB transactions.
    const response = await fetch(
      new URL("/internal/assessment-erasure", baseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Api-Key": key,
          ...(input.correlationId
            ? { "X-Correlation-Id": input.correlationId }
            : {}),
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new Error("Assessment runtime erasure did not complete");
    erasureResultSchema.parse(await response.json());
  }
}
