import { randomUUID } from "node:crypto";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { HttpStatus } from "@nestjs/common";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS,
} from "@lcsp/contracts/assessment-domain";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_ACTIVITY_KINDS,
  assessmentEventTokenUsageSchema,
} from "@lcsp/contracts/assessment";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
} from "@lcsp/contracts/evidence";
import { asRecord } from "@lcsp/contracts/shared";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { ROOT_AUDIT_ACTOR } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { deterministicUuid } from "../../../domain/domain-ids.js";
import { PublishAgentStreamEventCommand } from "./publish-agent-stream-event.command.js";
const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const optionalStreamText = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
@CommandHandler(PublishAgentStreamEventCommand)
export class PublishAgentStreamEventHandler implements ICommandHandler<PublishAgentStreamEventCommand> {
  constructor(
    private readonly runtimeEvents: AssessmentRuntimeEventService,
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly events: AssessmentEventAppender,
  ) {}
  async execute(command: PublishAgentStreamEventCommand) {
    const payload = command.payload;
    const correlationId = command.correlationId?.trim() ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const preparationRunId = payload.preparation_run_id?.trim() ?? null;
      const assessmentRun = preparationRunId
        ? null
        : await this.authority.authorizeInTx(tx, {
            assessmentId: payload.assessment_id as string,
            leaseToken: command.leaseToken,
            correlationId,
            requireActive: false,
          });
      const preparationRun = preparationRunId
        ? await tx.ruleSetPreparationRun.findUnique({
            where: { id: preparationRunId },
            select: { id: true },
          })
        : null;
      const executionId = preparationRun?.id ?? assessmentRun?.executionId;
      if (!executionId || payload.run_id !== executionId) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
          correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }
      const namespace = Array.isArray(payload.namespace)
        ? payload.namespace.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      const event = await this.runtimeEvents.publishAgentStreamEvent(
        {
          eventId: optionalText(payload.event_id),
          clientSequence:
            typeof payload.client_sequence === "number" &&
            Number.isSafeInteger(payload.client_sequence)
              ? payload.client_sequence
              : null,
          ...(payload.assessment_id
            ? { assessmentId: payload.assessment_id.trim() }
            : {}),
          boundaryType: preparationRunId
            ? AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation
            : AGENT_STREAM_BOUNDARY_TYPES.assessment,
          boundaryId: preparationRunId ?? payload.assessment_id?.trim(),
          preparationRunId,
          runId: payload.run_id.trim(),
          correlationId,
          eventType: payload.event_type,
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
          data: {
            ...(asRecord(payload.data) ?? {}),
            runtimeRunId: executionId,
          },
        },
        tx,
      );
      if (
        !preparationRunId &&
        event &&
        (event.eventType ===
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted ||
          event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolResult)
      ) {
        const isModel =
          event.eventType ===
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted;
        const invocationId = optionalText(asRecord(event.data)?.invocation_id);
        // Display counters from the persisted usage authority, never from model/tool text.
        const usage =
          isModel && invocationId
            ? await tx.llmUsageEvent.findFirst({
                where: {
                  assessmentId: event.assessmentId,
                  runId: executionId,
                  invocationId,
                },
                select: {
                  inputTokens: true,
                  outputTokens: true,
                  totalTokens: true,
                },
              })
            : null;
        const tokens =
          usage &&
          usage.inputTokens !== null &&
          usage.outputTokens !== null &&
          usage.totalTokens !== null
            ? assessmentEventTokenUsageSchema.safeParse({
                invocationId,
                promptTokens: Number(usage.inputTokens),
                completionTokens: Number(usage.outputTokens),
                totalTokens: Number(usage.totalTokens),
              })
            : null;
        await this.events.appendInTx(tx, {
          assessmentId: event.assessmentId as string,
          correlationId,
          eventId: deterministicUuid(
            `${event.assessmentId}:${executionId}:${event.eventType}:${isModel ? (invocationId ?? optionalText(asRecord(event.data)?.model_step_id) ?? event.eventId) : (event.toolCallId ?? event.eventId)}`,
          ),
          eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.ASSESSMENT_ROOT,
          executionId,
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          payload: {
            kind: isModel
              ? ASSESSMENT_ACTIVITY_KINDS.MODEL
              : ASSESSMENT_ACTIVITY_KINDS.TOOL,
            labelKey: isModel
              ? ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS.MODEL_STEP_COMPLETED
              : ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS.REPOSITORY_INSPECTED,
          },
          ...(tokens?.success ? { tokenUsage: tokens.data } : {}),
          auditActor: ROOT_AUDIT_ACTOR,
        });
      }
      return { recorded: event !== null, eventId: event?.eventId ?? null };
    });
  }
}
