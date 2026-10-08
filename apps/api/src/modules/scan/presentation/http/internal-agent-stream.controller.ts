import { randomUUID } from "node:crypto";

import {
  isAssessmentAgentStreamEventType,
  isAssessmentAgentStreamStage,
} from "@lcsp/contracts/evidence";
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";

import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { WorkerApiKeyGuard } from "./worker-api-key.guard.js";

interface WorkerAgentStreamEventRequest {
  event_id?: unknown;
  client_sequence?: unknown;
  assessment_id?: unknown;
  run_id?: unknown;
  correlation_id?: unknown;
  event_type?: unknown;
  stage?: unknown;
  engineering_rule_id?: unknown;
  source?: unknown;
  agent_name?: unknown;
  subagent_name?: unknown;
  namespace?: unknown;
  node_name?: unknown;
  message_id?: unknown;
  tool_name?: unknown;
  tool_call_id?: unknown;
  status?: unknown;
  text?: unknown;
  data?: unknown;
}

const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const optionalStreamText = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * The only `/internal/scan-jobs/*` route that survives the V1 retirement. The worker's generic
 * boundary invocation reports `BOUNDARY_STARTED`/`BOUNDARY_FAILED` for every boundary that carries
 * an `assessmentId` (including the V2 Root), so this path stays live; its URL is kept for worker
 * compatibility and is renamed in W7.
 */
@Controller("internal/scan-jobs")
export class InternalAgentStreamController {
  constructor(private readonly runtimeEvents: AssessmentRuntimeEventService) {}

  /** Accepts one live Deep Agents/LangGraph stream event from the trusted worker. */
  @Post("agent-stream-events")
  @HttpCode(202)
  @UseGuards(WorkerApiKeyGuard)
  async recordAgentStreamEvent(
    @Body() payload: WorkerAgentStreamEventRequest,
    @Headers("x-correlation-id") headerCorrelationId?: string,
  ) {
    if (
      typeof payload.assessment_id !== "string" ||
      !payload.assessment_id.trim() ||
      typeof payload.run_id !== "string" ||
      !payload.run_id.trim() ||
      !isAssessmentAgentStreamEventType(payload.event_type)
    ) {
      throw new BadRequestException("invalid agent stream event");
    }
    const namespace = Array.isArray(payload.namespace)
      ? payload.namespace.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const event = await this.runtimeEvents.publishAgentStreamEvent({
      eventId: optionalText(payload.event_id),
      clientSequence:
        typeof payload.client_sequence === "number" &&
        Number.isSafeInteger(payload.client_sequence)
          ? payload.client_sequence
          : null,
      assessmentId: payload.assessment_id.trim(),
      runId: payload.run_id.trim(),
      correlationId:
        optionalText(payload.correlation_id) ??
        headerCorrelationId?.trim() ??
        randomUUID(),
      eventType: payload.event_type,
      stage: isAssessmentAgentStreamStage(payload.stage) ? payload.stage : null,
      engineeringRuleId: optionalText(payload.engineering_rule_id),
      source: optionalText(payload.source),
      agentName: optionalText(payload.agent_name),
      subagentName: optionalText(payload.subagent_name),
      namespace,
      nodeName: optionalText(payload.node_name),
      messageId: optionalText(payload.message_id),
      toolName: optionalText(payload.tool_name),
      toolCallId: optionalText(payload.tool_call_id),
      status: optionalText(payload.status),
      text: optionalStreamText(payload.text),
      data: payload.data,
    });
    return resultEnvelope({
      recorded: event !== null,
      eventId: event?.eventId ?? null,
    });
  }
}
