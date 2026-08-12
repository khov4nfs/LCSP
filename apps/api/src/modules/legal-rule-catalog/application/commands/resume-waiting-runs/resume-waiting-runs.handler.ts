import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { LegalRetrievalIndexStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_STATUSES,
} from "@lcsp/contracts/evidence";
import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  LEGAL_MATCHING_REQUEST_COMMAND,
  LEGAL_RULE_LIFECYCLE_STATUSES,
  RESUME_WAITING_RUNS_TOOL,
} from "@lcsp/contracts/legal-rule-catalog";
import { VERIFIED_PROFILE_STATUSES } from "@lcsp/contracts/scan";

import {
  toPrismaLegalRuleLifecycleStatus,
  toPrismaVerifiedProfileStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ResumeWaitingRunsCommand } from "./resume-waiting-runs.command.js";

type ResumeWaitingRunsResponse = {
  status: string;
  toolName: string;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    corpusVersionId: string;
  };
  provenanceRef: string;
  coverageState: string;
  evidenceRefs: string[];
  limitations: Array<{
    code: string;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    eligibleRunCount: number;
    resumedRunCount: number;
    skippedRunCount: number;
    skips: Array<{ runRef: string; reason: string }>;
  };
};

const BLOCK_CODES = {
  corpusNotApproved: "CORPUS_VERSION_NOT_APPROVED",
  indexNotReady: "CORPUS_INDEX_NOT_READY",
} as const;

const OUTBOX_VISIBLE_STATUSES = ["PENDING", "PUBLISHED", "FAILED"] as const;

@CommandHandler(ResumeWaitingRunsCommand)
export class ResumeWaitingRunsHandler implements ICommandHandler<
  ResumeWaitingRunsCommand,
  ResumeWaitingRunsResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: ResumeWaitingRunsCommand,
  ): Promise<ResumeWaitingRunsResponse> {
    const boundedMaxRuns = Math.max(
      1,
      Math.min(command.maxRuns, RESUME_WAITING_RUNS_TOOL.maxRuns),
    );

    const corpus = await this.prisma.legalCorpusVersion.findFirst({
      where: {
        id: command.corpusVersionId,
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
      },
      select: { id: true, approvedAt: true },
    });
    if (!corpus) {
      return this.blockedResponse(
        command,
        BLOCK_CODES.corpusNotApproved,
        "The requested corpus version is not approved.",
      );
    }

    const index = await this.prisma.legalRetrievalIndex.findFirst({
      where: {
        legalCorpusVersionId: corpus.id,
        status: LegalRetrievalIndexStatus.VALID,
        validatedAt: { not: null },
        validationManifestRef: { not: null },
      },
      orderBy: [{ validatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!index) {
      return this.blockedResponse(
        command,
        BLOCK_CODES.indexNotReady,
        "The approved corpus version does not have a validated retrieval index.",
      );
    }

    const cutoff = corpus.approvedAt ?? new Date();
    const approvedProfiles = await this.prisma.verifiedProfile.findMany({
      where: {
        status: toPrismaVerifiedProfileStatus(
          VERIFIED_PROFILE_STATUSES.approved,
        ),
        approvedAt: { lte: cutoff },
      },
      orderBy: [{ approvedAt: "asc" }, { createdAt: "asc" }],
      take: RESUME_WAITING_RUNS_TOOL.maxRuns,
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
        approvedAt: true,
      },
    });

    const profileIds = approvedProfiles.map((profile) => profile.id);
    const [existingMatches, existingCommands] = profileIds.length
      ? await Promise.all([
          this.prisma.legalRuleMatch.findMany({
            where: {
              verifiedProfileId: { in: profileIds },
              corpusVersionId: corpus.id,
            },
            select: { verifiedProfileId: true },
          }),
          this.prisma.outboxMessage.findMany({
            where: {
              aggregateType: "VERIFIED_PROFILE",
              aggregateId: { in: profileIds },
              eventType: LEGAL_MATCHING_REQUEST_COMMAND,
              status: { in: [...OUTBOX_VISIBLE_STATUSES] },
            },
            select: { aggregateId: true },
          }),
        ])
      : [[], []];

    const matchedProfileIds = new Set(
      existingMatches.map((match) => match.verifiedProfileId),
    );
    const commandedProfileIds = new Set(
      existingCommands.map((message) => message.aggregateId),
    );

    const skips: Array<{ runRef: string; reason: string }> = [];
    const eligibleProfiles: Array<(typeof approvedProfiles)[number]> = [];
    for (const profile of approvedProfiles) {
      const runRef = `verified-profile:${profile.id}`;
      if (matchedProfileIds.has(profile.id)) {
        skips.push({ runRef, reason: "LEGAL_MATCH_ALREADY_EXISTS" });
        continue;
      }
      if (commandedProfileIds.has(profile.id)) {
        skips.push({ runRef, reason: "LEGAL_MATCH_ALREADY_QUEUED" });
        continue;
      }
      eligibleProfiles.push(profile);
      if (eligibleProfiles.length >= boundedMaxRuns) break;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const profile of eligibleProfiles) {
        const event = buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.verifiedProfile,
          aggregateId: profile.id,
          eventType: LEGAL_MATCHING_REQUEST_COMMAND,
          organizationId: profile.organizationId,
          assessmentId: profile.assessmentId,
          correlationId: command.correlationId,
          causationId: profile.id,
          actor: {
            id: AUDIT_ACTOR_IDS.legalRuleMatchWorker,
            type: AUDIT_ACTOR_TYPES.service,
          },
          result: LEGAL_MATCHING_REQUEST_COMMAND,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `${profile.id}:${LEGAL_MATCHING_REQUEST_COMMAND}:${corpus.id}`,
          payload: {
            verifiedProfileId: profile.id,
            assessmentId: profile.assessmentId,
            corpusVersionId: corpus.id,
            checkpointRef: `resume:${command.idempotencyKey}:${profile.id}`,
            correlationId: command.correlationId,
          },
        });
        await this.outboxRepository.enqueue(event, tx);
      }
    });

    const response: ResumeWaitingRunsResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: RESUME_WAITING_RUNS_TOOL.name,
      toolVersion: RESUME_WAITING_RUNS_TOOL.version,
      configHash: RESUME_WAITING_RUNS_TOOL.configHash,
      correlationId: command.correlationId,
      artifactVersions: { corpusVersionId: corpus.id },
      provenanceRef: `tool-execution:${command.correlationId}`,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: eligibleProfiles.map(
        (profile) => `verified-profile:${profile.id}`,
      ),
      limitations: [],
      result: {
        eligibleRunCount: eligibleProfiles.length,
        resumedRunCount: eligibleProfiles.length,
        skippedRunCount: skips.length,
        skips,
      },
    };

    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.waitingRunsResumed,
      actorId: AUDIT_ACTOR_IDS.legalRuleMatchWorker,
      organizationId: null,
      assessmentId: null,
      resourceType: AUDIT_RESOURCE_TYPES.workerTask,
      resourceId: `resume-waiting-runs:${corpus.id}`,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      actor: {
        id: AUDIT_ACTOR_IDS.legalRuleMatchWorker,
        type: AUDIT_ACTOR_TYPES.service,
      },
      payload: {
        toolName: response.toolName,
        corpusVersionId: corpus.id,
        resumedRunCount: response.result.resumedRunCount,
        skippedRunCount: response.result.skippedRunCount,
        idempotencyKey: command.idempotencyKey,
      },
    });

    return response;
  }

  private blockedResponse(
    command: ResumeWaitingRunsCommand,
    code: string,
    reason: string,
  ): ResumeWaitingRunsResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      toolName: RESUME_WAITING_RUNS_TOOL.name,
      toolVersion: RESUME_WAITING_RUNS_TOOL.version,
      configHash: RESUME_WAITING_RUNS_TOOL.configHash,
      correlationId: command.correlationId,
      artifactVersions: { corpusVersionId: command.corpusVersionId },
      provenanceRef: `tool-execution:${command.correlationId}`,
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      evidenceRefs: [],
      limitations: [
        {
          code,
          affectedScopeRef: `corpus-version:${command.corpusVersionId}`,
          reason,
          retryable: false,
        },
      ],
      result: {
        eligibleRunCount: 0,
        resumedRunCount: 0,
        skippedRunCount: 0,
        skips: [],
      },
    };
  }
}
