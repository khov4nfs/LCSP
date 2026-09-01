import {
  AGENTIC_TOOL_STATUSES,
  EVIDENCE_ERROR_CODES,
  VERIFIED_AGENT_EPISODE_RECORD_STATUSES,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { RetrieveVerifiedAgentEpisodesQuery } from "./retrieve-verified-agent-episodes.query.js";

@QueryHandler(RetrieveVerifiedAgentEpisodesQuery)
export class RetrieveVerifiedAgentEpisodesHandler implements IQueryHandler<RetrieveVerifiedAgentEpisodesQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: RetrieveVerifiedAgentEpisodesQuery) {
    const ownerAgent = requiredString(
      query.input.ownerAgent ?? query.input.owner_agent,
      query.correlationId,
    );
    const expectedVersions = record(
      query.input.artifactVersions ?? query.input.artifact_versions,
    );
    const expectedRuleIds = stringArray(
      query.input.engineeringRuleIds ?? query.input.engineering_rule_ids,
    );
    const limit = numberWithDefault(query.input.limit, 5);

    const rows = await this.prisma.verifiedAgentEpisode.findMany({
      where: {
        assessmentId: query.assessmentId,
        ownerAgent,
        status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
    });

    const candidates = rows
      .filter((episode) =>
        expectedRuleIds.every((ruleId) =>
          episode.engineeringRuleIds.includes(ruleId),
        ),
      )
      .filter((episode) =>
        versionsMatch(episode.artifactVersions, expectedVersions),
      )
      .slice(0, limit)
      .map((episode) => toEpisodeContract(episode));

    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      episodes: candidates,
      retrieval: {
        mode: "EXACT_FILTER",
      },
      limitations: [],
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

function versionsMatch(
  value: Prisma.JsonValue,
  expected: Record<string, unknown>,
): boolean {
  const actual = record(value);
  return Object.entries(expected).every(([key, expectedValue]) => {
    return actual[key] === expectedValue;
  });
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

function numberWithDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 10)
    : fallback;
}
