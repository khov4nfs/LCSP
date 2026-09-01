import {
  AGENTIC_TOOL_STATUSES,
  EVIDENCE_ERROR_CODES,
  VERIFIED_AGENT_EPISODE_RECORD_STATUSES,
  VERIFIED_AGENT_EPISODE_TRUST_LEVELS,
  VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { CaptureVerifiedAgentEpisodeCommand } from "./capture-verified-agent-episode.command.js";

@CommandHandler(CaptureVerifiedAgentEpisodeCommand)
export class CaptureVerifiedAgentEpisodeHandler implements ICommandHandler<CaptureVerifiedAgentEpisodeCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(command: CaptureVerifiedAgentEpisodeCommand) {
    const input = command.input;
    const id = requiredString(
      input.record_id ?? input.recordId,
      command.correlationId,
    );
    const assessmentId = requiredString(
      input.assessment_id ?? input.assessmentId ?? command.assessmentId,
      command.correlationId,
    );
    if (assessmentId !== command.assessmentId) {
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        command.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }
    const contentHash = requiredString(
      input.content_hash ?? input.contentHash,
      command.correlationId,
    );
    const domainKey = requiredString(
      input.domain_key ?? input.domainKey,
      command.correlationId,
    );
    const successfulStrategySummary =
      optionalString(
        input.successful_strategy_summary ?? input.successfulStrategySummary,
      ) ??
      optionalString(input.summary) ??
      "";
    const summary = optionalString(input.summary) ?? "";
    const handoff = record(input.handoff ?? input.handoffJson);
    const validationStatus = verifiedValidationStatus(
      input.validation_status ?? input.validationStatus,
      command.correlationId,
    );

    const episode = await this.prisma.verifiedAgentEpisode.upsert({
      where: {
        assessmentId_contentHash: {
          assessmentId,
          contentHash,
        },
      },
      create: {
        id,
        assessmentId,
        ownerAgent: requiredString(
          input.owner_agent ?? input.ownerAgent,
          command.correlationId,
        ),
        workflowRunId: optionalString(
          input.workflow_run_id ?? input.workflowRunId,
        ),
        engineeringRuleIds: stringArray(
          input.engineering_rule_ids ?? input.engineeringRuleIds,
        ),
        artifactVersions: record(
          input.artifact_versions ?? input.artifactVersions,
        ) as Prisma.InputJsonObject,
        trustLevel:
          optionalString(input.trust_level ?? input.trustLevel) ??
          VERIFIED_AGENT_EPISODE_TRUST_LEVELS.verifiedExample,
        validationStatus,
        schemaVersion: requiredString(
          input.schema_version ?? input.schemaVersion,
          command.correlationId,
        ),
        contentHash,
        domainKey,
        inputSignature: requiredString(
          input.input_signature ?? input.inputSignature,
          command.correlationId,
        ),
        successfulStrategySummary,
        evidenceRefs: stringArray(input.evidence_refs ?? input.evidenceRefs),
        promptVersion:
          optionalString(input.prompt_version ?? input.promptVersion) ??
          "unknown",
        modelId: optionalString(input.model_id ?? input.modelId) ?? "unknown",
        summary,
        handoffJson: handoff as Prisma.InputJsonObject,
        status:
          optionalString(input.status) ??
          VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
        expiresAt: optionalDate(input.expires_at ?? input.expiresAt),
      },
      update: {
        workflowRunId: optionalString(
          input.workflow_run_id ?? input.workflowRunId,
        ),
        successfulStrategySummary: successfulStrategySummary,
        evidenceRefs: stringArray(input.evidence_refs ?? input.evidenceRefs),
        promptVersion:
          optionalString(input.prompt_version ?? input.promptVersion) ??
          "unknown",
        modelId: optionalString(input.model_id ?? input.modelId) ?? "unknown",
        summary,
        handoffJson: handoff as Prisma.InputJsonObject,
        validationStatus,
        status:
          optionalString(input.status) ??
          VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
        expiresAt: optionalDate(input.expires_at ?? input.expiresAt),
      },
    });

    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      episode: toEpisodeContract(episode),
    };
  }
}

function toEpisodeContract(episode: {
  id: string;
  ownerAgent: string;
  workflowRunId: string | null;
  assessmentId: string;
  engineeringRuleIds: string[];
  artifactVersions: Prisma.JsonValue;
  trustLevel: string;
  validationStatus: string;
  schemaVersion: string;
  contentHash: string;
  domainKey: string;
  inputSignature: string;
  successfulStrategySummary: string;
  evidenceRefs: string[];
  promptVersion: string;
  modelId: string;
  summary: string;
  handoffJson: Prisma.JsonValue;
  createdAt: Date;
  expiresAt: Date | null;
  status: string;
}) {
  return {
    record_id: episode.id,
    owner_agent: episode.ownerAgent,
    workflow_run_id: episode.workflowRunId,
    assessment_id: episode.assessmentId,
    engineering_rule_ids: episode.engineeringRuleIds,
    artifact_versions: episode.artifactVersions,
    trust_level: episode.trustLevel,
    validation_status: episode.validationStatus,
    schema_version: episode.schemaVersion,
    content_hash: episode.contentHash,
    domain_key: episode.domainKey,
    input_signature: episode.inputSignature,
    successful_strategy_summary: episode.successfulStrategySummary,
    evidence_refs: episode.evidenceRefs,
    prompt_version: episode.promptVersion,
    model_id: episode.modelId,
    summary: episode.summary,
    handoff: episode.handoffJson,
    created_at: episode.createdAt.toISOString(),
    expires_at: episode.expiresAt?.toISOString() ?? null,
    status: episode.status,
  };
}

function requiredString(value: unknown, correlationId: string): string {
  const result = optionalString(value);
  if (!result) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return result;
}

function verifiedValidationStatus(value: unknown, correlationId: string) {
  const status =
    optionalString(value) ??
    VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES.verified;
  if (status !== VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES.verified) {
    throw problemException(
      EVIDENCE_ERROR_CODES.validationFailed,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  }
  return VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES.verified;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalDate(value: unknown): Date | null {
  const text = optionalString(value);
  return text ? new Date(text) : null;
}
