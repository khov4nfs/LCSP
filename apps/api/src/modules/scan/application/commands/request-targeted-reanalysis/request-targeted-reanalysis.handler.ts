import { randomUUID } from "node:crypto";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import { GITHUB_INTEGRATION_EVENT_TYPES } from "@lcsp/contracts/github-integration";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import {
  REQUEST_TARGETED_REANALYSIS_TOOL,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TARGETED_REANALYSIS_CAPACITY_POLICY,
  TARGETED_REANALYSIS_COVERAGE_STATES,
  TARGETED_REANALYSIS_REQUEST_STATES,
  TARGETED_REANALYSIS_RESPONSE_STATES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
} from "@lcsp/contracts/scan";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import {
  toPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanTriggerSource,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { RequestTargetedReanalysisResponse } from "../../contracts/scan/targeted-reanalysis.contract.js";
import { RequestTargetedReanalysisCommand } from "./request-targeted-reanalysis.command.js";

const ALLOWED_ANALYZERS = new Set([
  "RUN_SEMGREP_RULES",
  "RUN_PYTHON_SEMANTIC_ANALYSIS",
  "RUN_TS_JS_SEMANTIC_ANALYSIS",
  "RUN_STRUCTURAL_AUGMENTATION",
]);

@CommandHandler(RequestTargetedReanalysisCommand)
export class RequestTargetedReanalysisHandler implements ICommandHandler<RequestTargetedReanalysisCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(
    command: RequestTargetedReanalysisCommand,
  ): Promise<RequestTargetedReanalysisResponse> {
    const { input, pbacContext, correlationId } = command;
    this.assertInput(input, correlationId);
    const organizationId = pbacContext.organizationId;

    const existing = await this.prisma.targetedReanalysisRequest.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.assessmentId !== input.assessmentId ||
        existing.inputEvidenceReportId !== input.inputArtifactVersion
      ) {
        throw problemException(
          SCAN_ERROR_CODES.targetedReanalysisIdempotencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return this.buildResponse({
        requestId: existing.id,
        inputEvidenceReportId: existing.inputEvidenceReportId,
        analyzerId: existing.analyzerId,
        checkpointRef: existing.checkpointRef,
        correlationId,
        scopeRef: `scope:${existing.id}`,
        auditRef: `audit:${existing.id}`,
        state: TARGETED_REANALYSIS_RESPONSE_STATES.alreadyQueued,
      });
    }

    const requestId = randomUUID();
    const scanJobId = randomUUID();
    const checkpointRef = `checkpoint:${requestId}`;
    const report = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        id: input.inputArtifactVersion,
        assessmentId: input.assessmentId,
        organizationId,
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      },
      select: { id: true, evidencePayload: true, snapshotId: true },
    });
    const snapshot = report
      ? await this.prisma.repositorySnapshot.findFirst({
          where: {
            id: report.snapshotId,
            assessmentId: input.assessmentId,
            organizationId,
          },
          select: { id: true, commitSha: true },
        })
      : null;
    if (!report || !snapshot) {
      throw problemException(
        SCAN_ERROR_CODES.evidenceReportNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const normalizedScope = this.resolveScope(
      input,
      report.evidencePayload,
      correlationId,
    );
    const scopeRef = `scope:${requestId}`;
    const auditRef = `audit:${requestId}`;
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${organizationId}))
      `;
      const now = new Date();
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const [fifteenMinuteCount, dailyCount, activeCount, queuedCount] =
        await Promise.all([
          tx.targetedReanalysisRequest.count({
            where: { organizationId, createdAt: { gte: fifteenMinutesAgo } },
          }),
          tx.targetedReanalysisRequest.count({
            where: { organizationId, createdAt: { gte: twentyFourHoursAgo } },
          }),
          tx.targetedReanalysisRequest.count({
            where: {
              organizationId,
              state: {
                in: [
                  TARGETED_REANALYSIS_REQUEST_STATES.queued,
                  TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
                  TARGETED_REANALYSIS_REQUEST_STATES.running,
                ],
              },
            },
          }),
          tx.targetedReanalysisRequest.count({
            where: {
              organizationId,
              state: TARGETED_REANALYSIS_REQUEST_STATES.queued,
            },
          }),
        ]);
      if (
        fifteenMinuteCount >=
          TARGETED_REANALYSIS_CAPACITY_POLICY.maxRequestsPerFifteenMinutes ||
        dailyCount >=
          TARGETED_REANALYSIS_CAPACITY_POLICY.maxRequestsPerTwentyFourHours
      ) {
        throw problemException(
          SCAN_ERROR_CODES.targetedReanalysisRateLimited,
          correlationId,
          { status: HttpStatus.TOO_MANY_REQUESTS },
        );
      }
      if (
        queuedCount >=
          TARGETED_REANALYSIS_CAPACITY_POLICY.maxQueuedPerOrganization ||
        activeCount >=
          TARGETED_REANALYSIS_CAPACITY_POLICY.maxActivePerOrganization
      ) {
        throw problemException(
          SCAN_ERROR_CODES.targetedReanalysisCapacityExhausted,
          correlationId,
          { status: HttpStatus.TOO_MANY_REQUESTS },
        );
      }
      const row = await tx.targetedReanalysisRequest.create({
        data: {
          id: requestId,
          scanJobId,
          assessmentId: input.assessmentId,
          organizationId,
          inputEvidenceReportId: input.inputArtifactVersion,
          snapshotId: report.snapshotId,
          commitSha: snapshot.commitSha,
          analyzerId: input.analyzerId,
          normalizedScope,
          reasonRequirementId: input.reasonRequirementId,
          idempotencyKey: input.idempotencyKey,
          checkpointRef,
          correlationId,
        },
      });
      await tx.targetedReanalysisCheckpoint.create({
        data: {
          id: checkpointRef,
          requestId,
          correlationId,
        },
      });
      await tx.repositoryScanJob.create({
        data: {
          id: scanJobId,
          assessmentId: input.assessmentId,
          snapshotId: report.snapshotId,
          organizationId,
          idempotencyKey: `reanalysis:${input.idempotencyKey}`,
          triggerSource: toPrismaRepositoryScanTriggerSource(
            REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
          ),
          status: toPrismaRepositoryScanJobStatus(
            REPOSITORY_SCAN_JOB_STATUSES.queued,
          ),
          correlationId,
        },
      });
      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.targetedReanalysisRequest,
          aggregateId: requestId,
          eventType: GITHUB_INTEGRATION_EVENT_TYPES.targetedReanalysisRequested,
          organizationId,
          assessmentId: input.assessmentId,
          correlationId,
          causationId: correlationId,
          actor: { id: pbacContext.userId, type: AUDIT_ACTOR_TYPES.user },
          result: SCAN_EVENT_TYPES.targetedReanalysisQueuedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          authorizationAction: PBAC_ACTIONS.technicalEvidenceReanalyze,
          idempotencyKey: input.idempotencyKey,
          payload: {
            requestId,
            scanJobId,
            assessmentId: input.assessmentId,
            inputEvidenceReportId: input.inputArtifactVersion,
            snapshotId: report.snapshotId,
            commitSha: snapshot.commitSha,
            analyzerId: input.analyzerId,
            normalizedScope,
            checkpointRef,
            correlationId,
          },
        }),
        tx,
      );
      return row;
    });
    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.targetedReanalysisQueuedAudit,
      actorId: pbacContext.userId,
      organizationId,
      assessmentId: input.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.workerTask,
      resourceId: requestId,
      correlationId,
      causationId: correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: SCAN_EVENT_TYPES.targetedReanalysisQueuedAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      payload: { requestId, checkpointRef, analyzerId: input.analyzerId },
    });
    return this.buildResponse({
      requestId: created.id,
      inputEvidenceReportId: input.inputArtifactVersion,
      analyzerId: input.analyzerId,
      checkpointRef,
      correlationId,
      scopeRef,
      auditRef,
      state: TARGETED_REANALYSIS_RESPONSE_STATES.queued,
    });
  }

  private assertInput(
    input: RequestTargetedReanalysisCommand["input"],
    correlationId: string,
  ): void {
    const pathPrefixes =
      "pathPrefixes" in input.scope ? input.scope.pathPrefixes : undefined;
    const subjectRefs =
      "subjectRefs" in input.scope ? input.scope.subjectRefs : undefined;
    const exactlyOneScope =
      Number(Boolean(pathPrefixes?.length)) +
        Number(Boolean(subjectRefs?.length)) ===
      1;
    if (!ALLOWED_ANALYZERS.has(input.analyzerId))
      throw problemException(
        SCAN_ERROR_CODES.targetedReanalysisInvalidAnalyzer,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    if (
      !exactlyOneScope ||
      (pathPrefixes?.length ?? 0) >
        REQUEST_TARGETED_REANALYSIS_TOOL.maxPathPrefixes ||
      (subjectRefs?.length ?? 0) >
        REQUEST_TARGETED_REANALYSIS_TOOL.maxSubjectRefs
    )
      throw problemException(
        SCAN_ERROR_CODES.targetedReanalysisInvalidScope,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
  }

  private resolveScope(
    input: RequestTargetedReanalysisCommand["input"],
    evidencePayload: unknown,
    correlationId: string,
  ): { pathPrefixes: string[] } {
    if ("pathPrefixes" in input.scope) {
      return { pathPrefixes: [...input.scope.pathPrefixes].sort() };
    }

    const pathPrefixes = resolveSubjectRefPathPrefixes(
      evidencePayload,
      input.scope.subjectRefs,
    );
    if (pathPrefixes.length === 0) {
      throw problemException(
        SCAN_ERROR_CODES.targetedReanalysisInvalidScope,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    return { pathPrefixes };
  }

  private buildResponse(input: {
    requestId: string;
    inputEvidenceReportId: string;
    analyzerId: string;
    checkpointRef: string;
    correlationId: string;
    scopeRef: string;
    auditRef: string;
    state: (typeof TARGETED_REANALYSIS_RESPONSE_STATES)[keyof typeof TARGETED_REANALYSIS_RESPONSE_STATES];
  }): RequestTargetedReanalysisResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: REQUEST_TARGETED_REANALYSIS_TOOL.name,
      toolVersion: REQUEST_TARGETED_REANALYSIS_TOOL.version,
      configHash: REQUEST_TARGETED_REANALYSIS_TOOL.configHash,
      correlationId: input.correlationId,
      artifactVersions: {
        technicalEvidenceReportId: input.inputEvidenceReportId,
      },
      provenanceRef: `tool-execution:${input.requestId}`,
      coverageState: TARGETED_REANALYSIS_COVERAGE_STATES.pending,
      evidenceRefs: [],
      limitations: [],
      result: {
        reanalysisRequestId: `reanalysis:${input.requestId}`,
        state: input.state,
        inputArtifactVersion: input.inputEvidenceReportId,
        requestedAnalyzer: input.analyzerId,
        scopeRef: input.scopeRef,
        checkpointRef: input.checkpointRef,
        auditRef: input.auditRef,
      },
    };
  }
}

const SUBJECT_REF_KINDS = {
  finding: "finding",
  node: "node",
  symbol: "symbol",
} as const;

type SubjectRefKind =
  (typeof SUBJECT_REF_KINDS)[keyof typeof SUBJECT_REF_KINDS];

type EvidenceRecord = Record<string, unknown>;

function resolveSubjectRefPathPrefixes(
  evidencePayload: unknown,
  subjectRefs: string[],
): string[] {
  const records = collectEvidenceRecords(evidencePayload);
  const prefixes = new Set<string>();
  for (const subjectRef of subjectRefs) {
    const parsed = parseSubjectRef(subjectRef);
    if (!parsed) continue;
    for (const record of records) {
      if (!matchesSubjectRef(record, parsed.kind, parsed.id)) continue;
      const pathPrefix = toPathPrefix(readFilePath(record));
      if (pathPrefix) prefixes.add(pathPrefix);
    }
  }
  return [...prefixes].sort();
}

function collectEvidenceRecords(value: unknown): EvidenceRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectEvidenceRecords(item));
  }
  if (!isEvidenceRecord(value)) return [];
  return [
    value,
    ...Object.values(value).flatMap((item) => collectEvidenceRecords(item)),
  ];
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSubjectRef(
  value: string,
): { kind: SubjectRefKind; id: string } | null {
  const [kind, id, ...rest] = value.split(":");
  if (rest.length > 0 || !id || !(kind in SUBJECT_REF_KINDS)) return null;
  return { kind: kind as SubjectRefKind, id };
}

function matchesSubjectRef(
  record: EvidenceRecord,
  kind: SubjectRefKind,
  id: string,
): boolean {
  if (kind === SUBJECT_REF_KINDS.finding) {
    return (
      record.finding_id === id ||
      record.findingId === id ||
      (Array.isArray(record.finding_ids) && record.finding_ids.includes(id)) ||
      (Array.isArray(record.findingIds) && record.findingIds.includes(id))
    );
  }
  if (kind === SUBJECT_REF_KINDS.node) {
    return record.node_id === id || record.nodeId === id;
  }
  return record.symbol_id === id || record.symbolId === id;
}

function readFilePath(record: EvidenceRecord): string | null {
  const value = record.file_path ?? record.filePath;
  return typeof value === "string" ? value : null;
}

function toPathPrefix(filePath: string | null): string | null {
  if (
    !filePath ||
    filePath.startsWith("/") ||
    filePath.split("/").includes("..")
  ) {
    return null;
  }
  const separatorIndex = filePath.lastIndexOf("/");
  if (separatorIndex <= 0) return null;
  return `${filePath.slice(0, separatorIndex + 1)}`;
}
